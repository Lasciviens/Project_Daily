import { supabase } from '../../../integrations/supabase/client'
import { logError } from '../../../shared/utils/logError'
import {
  createGoogleTask, updateGoogleTask, deleteGoogleTask, moveGoogleTask,
  completeGoogleTask, reopenGoogleTask, isGoogleTaskNotFound,
  type GoogleRemoteTask,
} from './googleTasksApi'
import { shouldSkipPendingCreate } from './googleTasksOutboxRules'

// Drains public.google_tasks_outbox — the queue migration 071's DB triggers
// populate atomically alongside every tasks INSERT/UPDATE/DELETE. This is
// the ONLY place that actually talks to Google for local→Google writes;
// the triggers only decide WHAT needs syncing, never call Google themselves
// (Postgres has no outbound HTTP).
//
// 'create'/'update' re-read the LIVE tasks row rather than trusting the
// outbox payload — avoids acting on a stale snapshot if the task was edited
// again after this row was enqueued. Only 'delete' relies on the payload,
// because by the time this runs the row may already be gone.

interface OutboxRow {
  id:         string
  user_id:    string
  task_id:    string
  operation:  'create' | 'update' | 'delete'
  payload:    Record<string, unknown>
  attempts:   number
}

// Both this browser drain and the cron drain (google-tasks-sync edge
// function) can run close enough in time to read the SAME pending row
// before either finishes processing it — a plain SELECT-then-process would
// let both call Google for the same 'create', producing a real duplicate
// task nothing cleans up. claim_google_tasks_outbox (migration 073, FIFO
// ordering added in 079) uses FOR UPDATE SKIP LOCKED so two concurrent
// claimers can never end up with the same row, AND never claims a newer row
// for a task while an older one for that SAME task is still outstanding.
async function claimRows(): Promise<OutboxRow[]> {
  const { data, error } = await supabase.rpc('claim_google_tasks_outbox', { p_respect_backoff: false })
  if (error) throw error
  return (data ?? []) as OutboxRow[]
}

async function resolveGoogleListId(googleTasklistId: string | null): Promise<string> {
  if (!googleTasklistId) return '@default'
  const { data } = await supabase.from('google_task_lists').select('google_id').eq('id', googleTasklistId).maybeSingle()
  return data?.google_id ?? '@default'
}

async function resolveGoogleParentId(parentTaskId: string | null): Promise<string | undefined> {
  if (!parentTaskId) return undefined
  const { data } = await supabase.from('tasks').select('google_task_id').eq('id', parentTaskId).maybeSingle()
  return data?.google_task_id ?? undefined
}

async function applySnapshot(taskId: string, remote: GoogleRemoteTask) {
  const { error } = await supabase.rpc('apply_google_task_snapshot', {
    p_task_id:              taskId,
    p_google_task_id:       remote.id,
    p_google_updated_at:    remote.updated,
    p_google_etag:          remote.etag ?? null,
    p_google_position:      remote.position ?? null,
    p_google_web_view_link: remote.webViewLink ?? null,
    p_google_links:         remote.links ?? null,
    p_google_hidden:        remote.hidden ?? false,
    p_google_deleted:       remote.deleted ?? false,
  })
  if (error) throw error
}

// Migration 079's stale-delete-safety net — only clears tasks.google_task_id
// when it STILL equals what THIS delete targeted, so a delete that (despite
// the FIFO claim ordering) somehow still runs after a newer create can never
// wipe the new id out from under it.
async function clearGoogleTaskIdIfMatches(taskId: string, expectedGoogleTaskId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('clear_google_task_id_if_matches', {
    p_task_id: taskId, p_expected_google_task_id: expectedGoogleTaskId,
  })
  if (error) throw error
  return !!data
}

// A durable retry row for an orphan Google Task this run couldn't clean up
// itself (the compensation delete below failed) — inserted as a plain
// 'delete' outbox row so the NEXT drain (this browser, or the cron poller)
// retries it with the exact same machinery, instead of the cleanup attempt
// living only in a log line that nothing ever revisits. task_id has no FK
// (see migration 071's table comment), so this is safe to insert even if
// the local task row is already gone.
async function enqueueOrphanCleanup(userId: string, taskId: string, googleTaskId: string, googleTasklistId: string | null) {
  const { error } = await supabase.from('google_tasks_outbox').insert({
    user_id: userId, task_id: taskId, operation: 'delete',
    payload: { google_task_id: googleTaskId, google_tasklist_id: googleTasklistId },
  })
  if (error) logError(`Failed to enqueue orphan Google Task cleanup: ${error.message}`, { taskId, googleTaskId })
}

async function processCreate(token: string, row: OutboxRow): Promise<void> {
  const { data: task } = await supabase.from('tasks').select('*').eq('id', row.task_id).maybeSingle()
  if (!task) return // hard-deleted since this row was enqueued — nothing to create
  // See googleTasksOutboxRules.ts for the full rationale on both guards.
  // Returning without creating anything still lets the outer drain loop
  // delete this now-moot outbox row — a clean no-op, not a failure.
  if (shouldSkipPendingCreate(task, !!row.payload.force_recreate)) return

  const listId = await resolveGoogleListId(task.google_tasklist_id)
  const parent = await resolveGoogleParentId(task.parent_task_id)
  const remote = await createGoogleTask(token, listId, task, { parent })

  // The POST above is a real network round trip — the user (or another
  // write door) can cancel/delete/opt this task back out WHILE it's in
  // flight. Re-check the LIVE row before writing the new id anywhere:
  // resurrecting a Google representation the user just asked to remove
  // would be a real bug, not a harmless race.
  const { data: liveTask } = await supabase
    .from('tasks').select('id, google_sync_enabled, status').eq('id', row.task_id).maybeSingle()
  const stillWantsThisTask = !!liveTask && liveTask.google_sync_enabled && liveTask.status !== 'cancelled'

  if (!stillWantsThisTask) {
    await compensateOrphanCreate(token, listId, remote.id, row.user_id, row.task_id, task.google_tasklist_id)
    return // never write the new remote id onto a task that opted out
  }

  try {
    await applySnapshot(task.id, remote)
  } catch (err) {
    // The remote task now exists for real, but recording its id locally
    // failed — task.google_task_id is STILL NULL. Left alone, the next
    // drain retry would see no id, pass shouldSkipPendingCreate, and call
    // createGoogleTask AGAIN: a genuine duplicate (the exact failure class
    // migration 075's own header comment already documented once for this
    // same snapshot step). Compensate exactly like the opted-out case above
    // — delete the orphan (or durably queue its cleanup) — then rethrow so
    // this attempt is still recorded as failed/backed-off, but the NEXT
    // retry starts from a clean slate and creates exactly one task.
    await compensateOrphanCreate(token, listId, remote.id, row.user_id, row.task_id, task.google_tasklist_id)
    throw err
  }
  if (task.status === 'done') {
    const completed = await completeGoogleTask(token, listId, remote.id)
    await applySnapshot(task.id, completed)
  }
}

async function compensateOrphanCreate(
  token: string, listId: string, remoteTaskId: string, userId: string, taskId: string, googleTasklistId: string | null,
): Promise<void> {
  try {
    await deleteGoogleTask(token, listId, remoteTaskId)
  } catch (err) {
    if (!isGoogleTaskNotFound(err)) {
      // Compensation failed — don't just log it and move on. A durable
      // retry row means a later drain finishes the cleanup instead of
      // leaving an orphan Google Task nothing ever revisits.
      await enqueueOrphanCleanup(userId, taskId, remoteTaskId, googleTasklistId)
    }
  }
}

async function processUpdate(token: string, row: OutboxRow): Promise<void> {
  const { data: task } = await supabase.from('tasks').select('*').eq('id', row.task_id).maybeSingle()
  if (!task || !task.google_task_id) return // never actually created, or hard-deleted since

  const prevParent   = (row.payload.prev_parent_task_id as string | null | undefined) ?? null
  const prevTasklist = (row.payload.prev_google_tasklist_id as string | null | undefined) ?? null
  const parentChanged   = task.parent_task_id !== prevParent
  const tasklistChanged = task.google_tasklist_id !== prevTasklist

  const currentListId = await resolveGoogleListId(task.google_tasklist_id)

  // parent/position and list membership are output-only on patch/update —
  // tasks.move is the ONLY endpoint that can change them (verified live
  // against the Tasks API v1 discovery document).
  if (parentChanged || tasklistChanged) {
    const originListId = tasklistChanged ? await resolveGoogleListId(prevTasklist) : currentListId
    const parent = await resolveGoogleParentId(task.parent_task_id)
    const moved = await moveGoogleTask(token, originListId, task.google_task_id, {
      destinationTasklist: tasklistChanged ? currentListId : undefined,
      parent,
    })
    await applySnapshot(task.id, moved)
  }

  const patched = await updateGoogleTask(token, currentListId, task.google_task_id, task)

  if (task.status === 'done' && patched.status !== 'completed') {
    const completed = await completeGoogleTask(token, currentListId, task.google_task_id)
    await applySnapshot(task.id, completed)
  } else if (task.status !== 'done' && patched.status === 'completed') {
    const reopened = await reopenGoogleTask(token, currentListId, task.google_task_id)
    await applySnapshot(task.id, reopened)
  } else {
    await applySnapshot(task.id, patched)
  }
}

async function processDelete(token: string, row: OutboxRow): Promise<void> {
  const googleTaskId = row.payload.google_task_id as string | undefined
  if (!googleTaskId) return
  const listId = await resolveGoogleListId((row.payload.google_tasklist_id as string | null) ?? null)

  try {
    await deleteGoogleTask(token, listId, googleTaskId)
  } catch (err) {
    // Already gone on Google's side (e.g. deleted from the phone app too) —
    // that's the outcome we wanted, not a failure worth retrying. Real
    // status, never a message substring match.
    if (!isGoogleTaskNotFound(err)) throw err
  }

  // Only clear the local id if it STILL matches what THIS delete targeted
  // (migration 079) — a stale delete processed out of order relative to a
  // later force_recreate must never wipe a fresh id a newer create already
  // wrote. The unconditional apply_google_task_snapshot(p_clear_google_
  // task_id=true) this used to call had no such guard.
  await clearGoogleTaskIdIfMatches(row.task_id, googleTaskId)
}

export interface DrainResult {
  drained: number
  failed:  number
}

export async function drainGoogleTasksOutbox(token: string): Promise<DrainResult> {
  const rows = await claimRows()

  let drained = 0
  let failed  = 0

  for (const row of rows) {
    try {
      if (row.operation === 'create')      await processCreate(token, row)
      else if (row.operation === 'update') await processUpdate(token, row)
      else                                 await processDelete(token, row)

      await supabase.from('google_tasks_outbox').delete().eq('id', row.id)
      drained++
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      logError(`Google Tasks outbox drain failed: ${message}`, { taskId: row.task_id, operation: row.operation })
      const attempts = row.attempts + 1
      const backoffSeconds = Math.min(3600, 30 * 2 ** attempts) // capped exponential backoff
      await supabase
        .from('google_tasks_outbox')
        .update({
          attempts,
          last_error:    message,
          next_retry_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
          claimed_at:    null, // release the claim so a later retry can pick it up again
        })
        .eq('id', row.id)
    }
  }

  return { drained, failed }
}
