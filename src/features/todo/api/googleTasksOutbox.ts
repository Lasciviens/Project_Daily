import { supabase } from '../../../integrations/supabase/client'
import { logError } from '../../../shared/utils/logError'
import {
  createGoogleTask, updateGoogleTask, deleteGoogleTask, moveGoogleTask,
  getGoogleTask, completeGoogleTask, reopenGoogleTask, isGoogleTaskNotFound,
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

// A DB read error here used to be indistinguishable from "no row found" —
// both left `data` as null/undefined, and every caller treated that as a
// legitimate "nothing to resolve, fall back to the default" case. That's
// correct for an ACTUAL missing row, but silently wrong for a transient DB
// failure (a real bug: a task could get "no list found → @default" or a
// parent link could get dropped, purely because a read happened to fail,
// not because the referenced row doesn't exist).
async function resolveGoogleListId(googleTasklistId: string | null): Promise<string> {
  if (!googleTasklistId) return '@default'
  const { data, error } = await supabase.from('google_task_lists').select('google_id').eq('id', googleTasklistId).maybeSingle()
  if (error) throw error
  return data?.google_id ?? '@default'
}

async function resolveGoogleParentId(parentTaskId: string | null): Promise<string | undefined> {
  if (!parentTaskId) return undefined
  const { data, error } = await supabase.from('tasks').select('google_task_id').eq('id', parentTaskId).maybeSingle()
  if (error) throw error
  return data?.google_task_id ?? undefined
}

async function fetchTask(taskId: string) {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (error) throw error
  return data
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

async function patchPayload(rowId: string, payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('google_tasks_outbox').update({ payload }).eq('id', rowId)
  if (error) throw error
}

// ─────────────────────────────────────────────────────────────────────────────
// processCreate — checkpoint-in-place, never a second outbox row.
//
// Real bug fixed (found reviewing this file again, independently of the
// earlier applySnapshot-failure fix): the ORIGINAL fix for "createGoogleTask
// succeeds but applySnapshot fails" compensated by calling
// enqueueOrphanCleanup — INSERTING A NEW 'delete' row — when the
// compensation delete itself also failed. Under migration 079's per-task
// FIFO claim (added in the SAME review pass as this fix), that new row
// always sorts AFTER the original (still-outstanding, still-retrying)
// 'create' row for the same task_id — and FIFO means the newer row can
// NEVER be claimed while the older one is still outstanding. The result:
// the stale 'create' row keeps retrying (each retry POSTing AGAIN, since
// nothing recorded that a remote task already exists) and compounds a new
// orphan on every attempt, while the cleanup row queued behind it can never
// even run. A second outbox row for the SAME task's own cleanup is a
// design bug, not a rare edge case — this rewrite never creates one.
//
// Fixed by keeping ALL of this row's own state — including "a remote task
// already exists, here it is" and "that remote task must be deleted, not
// adopted" — in THIS row's own `payload`, checkpointed via patchPayload
// before any state transition. A retry of this SAME row (which, being the
// oldest outstanding row for its task, is exactly what 079's FIFO claims
// next) always resumes from that checkpoint instead of re-POSTing blindly:
//   - payload.created_remote_task absent → no remote task exists yet from
//     this row's own attempts; safe to POST fresh (after the normal
//     shouldSkipPendingCreate guard).
//   - payload.created_remote_task present, payload.abandon falsy → a
//     remote task already exists (created by an earlier attempt of THIS
//     row); reuse it, never re-POST.
//   - payload.abandon true → the existing remote task must be deleted (the
//     live tasks row opted out/cancelled while a create was in flight, or
//     checkpointing its id locally failed) and NOT adopted; retry only the
//     delete, never a create, until it lands.
export async function processCreate(token: string, row: OutboxRow): Promise<void> {
  let remote = row.payload.created_remote_task as GoogleRemoteTask | undefined
  // The list a checkpointed remote task actually lives in — resolved ONCE,
  // at create time, and checkpointed alongside created_remote_task (see
  // below). Real subtlety this avoids: re-resolving from either the
  // enqueue-time payload OR the task's LIVE google_tasklist_id on every
  // retry could point at a list the task has since MOVED to (a separate
  // 'update' row handles moving an existing remote task between lists —
  // see processUpdate's moveGoogleTask branch), which is not where this
  // already-created remote task lives until that move actually runs.
  let listId = row.payload.created_remote_tasklist as string | undefined

  if (remote && row.payload.abandon) {
    // A previous attempt (this task opted out mid-flight, or the checkpoint
    // write below failed) already decided this remote task must go. Retry
    // ONLY the delete — never re-POST — until it's confirmed gone. This row
    // stays the oldest outstanding row for its task under 079's FIFO claim,
    // correctly blocking any newer create/update for the same task until
    // Google's side is confirmed clean.
    try {
      await deleteGoogleTask(token, listId!, remote.id)
    } catch (err) {
      if (!isGoogleTaskNotFound(err)) throw err
    }
    return // cleanup landed — the drain loop deletes this row, done.
  }

  // Whether `remote` is being REUSED from a prior attempt's checkpoint
  // (true) vs. about to be freshly POSTed right below (false) — a fresh
  // POST always uses the task's CURRENT fields, so it needs no follow-up
  // sync; a reused remote might not (see the in-flight-edit note below).
  const wasReused = !!remote

  if (!remote) {
    const task = await fetchTask(row.task_id)
    if (!task) return // hard-deleted since this row was enqueued — nothing to create
    // See googleTasksOutboxRules.ts for the full rationale on both guards.
    if (shouldSkipPendingCreate(task, !!row.payload.force_recreate)) return

    // Resolved LIVE (the task's CURRENT google_tasklist_id), not from the
    // enqueue-time payload — matches this function's pre-rewrite behavior
    // and reflects a list change that landed before this row happened to
    // drain (its own 'update' row, if any, still runs afterward per FIFO —
    // irrelevant here since a fresh create always uses wherever the task
    // is NOW).
    listId = await resolveGoogleListId(task.google_tasklist_id)
    const parent = await resolveGoogleParentId(task.parent_task_id)
    remote = await createGoogleTask(token, listId, task, { parent })

    try {
      // Checkpoint immediately, INTO THIS SAME ROW — not a new one. If the
      // write itself fails, mark the remote task for abandonment (also in
      // THIS row) rather than deleting it synchronously here: the delete
      // gets its own dedicated, retried code path above instead of a
      // second failure mode inline in the happy path. created_remote_tasklist
      // is checkpointed alongside the remote task itself — the list a
      // retry must act against is wherever THIS remote task actually lives,
      // which is fixed at creation time, not re-derived later.
      await patchPayload(row.id, { ...row.payload, created_remote_task: remote, created_remote_tasklist: listId })
    } catch (checkpointError) {
      logError(`Failed to checkpoint Google Task create: ${(checkpointError as Error).message}`, { taskId: row.task_id })
      await patchPayload(row.id, { ...row.payload, created_remote_task: remote, created_remote_tasklist: listId, abandon: true }).catch(() => {
        // Best-effort — if THIS also fails, the row's payload is unchanged
        // (no created_remote_task recorded at all) and the next retry will
        // simply re-POST, exactly like today's behavior for any other
        // create failure. That residual risk is Google Tasks' own
        // documented limitation (insert() takes no client id / requestId,
        // unlike Calendar's events.insert), not something this code can
        // close further without one.
      })
      throw checkpointError
    }
  }

  // The POST is a real network round trip — the user (or another write
  // door) can cancel/delete/opt this task back out WHILE it's in flight, or
  // between retries of a checkpointed row. Re-check the LIVE row every time
  // before adopting remote: resurrecting a Google representation the user
  // just asked to remove would be a real bug, not a harmless race.
  const { data: liveTask, error: liveTaskError } = await supabase
    .from('tasks').select('id, google_sync_enabled, status').eq('id', row.task_id).maybeSingle()
  if (liveTaskError) throw liveTaskError
  const stillWantsThisTask = !!liveTask && liveTask.google_sync_enabled && liveTask.status !== 'cancelled'

  if (!stillWantsThisTask) {
    try {
      await deleteGoogleTask(token, listId!, remote.id)
      return // clean, in one pass — nothing to check on a later retry
    } catch (err) {
      if (isGoogleTaskNotFound(err)) return // already gone
      await patchPayload(row.id, { ...row.payload, created_remote_task: remote, created_remote_tasklist: listId, abandon: true })
      throw err
    }
  }

  const task = await fetchTask(row.task_id)

  // In-flight-edit gap fixed: a title/notes/due edit that lands strictly
  // between the original POST (whose fields are now stale, frozen at
  // creation time) and THIS retry finally persisting the id would
  // otherwise never reach Google at all — the DB trigger only enqueues an
  // 'update' row once tasks.google_task_id is actually set, which is
  // exactly the thing this retry loop hasn't managed to do yet. Pushing a
  // fresh PATCH with the task's CURRENT fields on every reused-checkpoint
  // pass (idempotent — PATCH always sends the full field set, never a
  // diff) closes that window; a freshly-POSTed remote already has current
  // fields and needs no such catch-up.
  if (wasReused && task) {
    remote = await updateGoogleTask(token, listId!, remote.id, task)
  }

  // remote is checkpointed in this row's own payload by now — a retry of
  // JUST this step (applySnapshot failing) re-enters above, finds
  // created_remote_task, and skips straight back here without a second POST.
  await applySnapshot(row.task_id, remote)

  if (task?.status === 'done') {
    const completed = await completeGoogleTask(token, listId!, remote.id)
    await applySnapshot(row.task_id, completed)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// processUpdate
async function processUpdate(token: string, row: OutboxRow): Promise<void> {
  const task = await fetchTask(row.task_id)
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

    // Idempotent-move check (real gap fixed): a retry of this SAME row —
    // e.g. the move above succeeded on a prior attempt but the PATCH below
    // or its own applySnapshot failed — used to call moveGoogleTask AGAIN
    // unconditionally. tasks.move has no documented no-op guarantee when
    // the task is already at the target parent/list; reordering side
    // effects on a redundant move are plausible, not just theoretical.
    // Fetching the current remote state first and skipping the call
    // entirely when it already matches the target makes every retry of
    // this branch genuinely idempotent.
    const currentRemote = await getGoogleTask(token, originListId, task.google_task_id)
    const alreadyAtTarget = (currentRemote.parent ?? null) === (parent ?? null)
      && !tasklistChanged // a list move has no cheap "already there" signal from a single-list GET — always attempt it
    const moved = alreadyAtTarget
      ? currentRemote
      : await moveGoogleTask(token, originListId, task.google_task_id, {
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

      // The row's own delete result is now checked: a failure here used to
      // still increment `drained` and let the caller believe the operation
      // fully completed, when in fact the outbox row (and whatever
      // idempotency state it carried — e.g. a create's checkpointed
      // created_remote_task) was still sitting there. Falling through to
      // the catch block below re-schedules a real retry instead of a false
      // "done".
      const { error: deleteError } = await supabase.from('google_tasks_outbox').delete().eq('id', row.id)
      if (deleteError) throw deleteError
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
