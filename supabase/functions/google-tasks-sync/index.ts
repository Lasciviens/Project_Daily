// google-tasks-sync — Phase 3 background poller for the Google Tasks
// integration (migration 071/072). Runs on a pg_cron schedule (migration
// 072, every 20 minutes) so a task added/edited/completed directly in the
// Google Tasks app (phone widget, Assistant, the Tasks web UI) reaches this
// app without anyone opening it — the missing piece Phase 1/2 left: those
// shipped real-time local→Google sync (the outbox, drained on every local
// mutation) and a manual pull button, but nothing that runs unattended.
//
// Self-contained (no supabase/functions/_shared/ import) per this repo's
// established Hevy-functions convention — Deno Dashboard deploys don't
// bundle sibling files. This means the Google Tasks REST helpers below are
// a deliberate, acknowledged duplicate of src/features/todo/api/
// googleTasksApi.ts's browser-side versions. If the Tasks API surface
// changes, update both.
//
// Auth: EITHER a real user JWT (a future in-app "Sync now" button, mirroring
// google-health-sync's Fetch-now path) OR the shared secret header
// `x-sync-secret: <GOOGLE_TASKS_SYNC_SECRET>` (the cron schedule). Deploy
// with "Enforce JWT Verification" OFF — same reason as the six functions
// already listed for that in CLAUDE.md.
//
// Token: reuses the ONE Google refresh token stored by calendar-oauth in
// user_calendar_tokens. UNLIKE google-health-sync, no down-scoping is
// needed here — the Health API's mixed-scope rejection (403
// DISALLOWED_OAUTH_SCOPES) is a Health-API-specific restriction; Calendar
// and Tasks scopes coexist on one token fine (calendar-token already mints
// full-scope tokens for Calendar without issue).
//
// Why the migration-071 RPCs needed a migration-072 change to be callable
// from here: they scope writes via `user_id = (SELECT auth.uid())`, which
// is NULL for a service-role caller (no user JWT on that connection at
// all). Every RPC call below passes p_user_id explicitly; the RPC honors it
// only when auth.role() = 'service_role' (a claim only the platform's own
// service key can present) — see migration 072's header comment.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']
function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-sync-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any>

const TASKS_BASE = 'https://www.googleapis.com/tasks/v1'

// Mirrors src/features/todo/api/googleTasksApi.ts's GoogleTasksApiError /
// isGoogleTaskNotFound exactly — Deno can't import that file (no _shared/
// imports per this repo's edge-function convention), so keep any change to
// this class mirrored here by hand. Carries the real HTTP status so "was
// this task genuinely deleted, or did the request merely fail?" is decided
// on the status, never a message substring match.
class GoogleTasksApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'GoogleTasksApiError'
    this.status = status
  }
}
function isGoogleTaskNotFound(error: unknown): boolean {
  return error instanceof GoogleTasksApiError && error.status === 404
}

async function googleRequest(token: string, path: string, options: RequestInit = {}): Promise<AnyRecord | null> {
  const res = await fetch(`${TASKS_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type':  'application/json',
      ...(options.headers ?? {}),
    },
  })
  if (res.status === 204) return null
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new GoogleTasksApiError(res.status, data?.error?.message ?? `Google Tasks error ${res.status}`)
  return data
}

// ── Task lists ──────────────────────────────────────────────────────────────
async function fetchGoogleTaskLists(token: string): Promise<AnyRecord[]> {
  const out: AnyRecord[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ maxResults: '100', ...(pageToken ? { pageToken } : {}) })
    const data = await googleRequest(token, `/users/@me/lists?${qs}`)
    out.push(...(data?.items ?? []))
    pageToken = data?.nextPageToken
  } while (pageToken)
  return out
}
async function fetchDefaultGoogleTaskList(token: string): Promise<AnyRecord> {
  return (await googleRequest(token, '/users/@me/lists/@default'))!
}

// ── Tasks ────────────────────────────────────────────────────────────────────
async function paginateTasks(token: string, listId: string, params: Record<string, string>): Promise<AnyRecord[]> {
  const out: AnyRecord[] = []
  let pageToken: string | undefined
  do {
    const qs = new URLSearchParams({ maxResults: '100', ...params, ...(pageToken ? { pageToken } : {}) })
    const data = await googleRequest(token, `/lists/${listId}/tasks?${qs}`)
    out.push(...(data?.items ?? []))
    pageToken = data?.nextPageToken
  } while (pageToken)
  return out
}
const fullGoogleTasksSync = (token: string, listId: string) =>
  paginateTasks(token, listId, { showCompleted: 'true', showHidden: 'true', showDeleted: 'true' })
const incrementalGoogleTasksSync = (token: string, listId: string, updatedMinIso: string) =>
  paginateTasks(token, listId, { showCompleted: 'true', showHidden: 'true', showDeleted: 'true', updatedMin: updatedMinIso })

function createGoogleTask(token: string, listId: string, task: AnyRecord, opts?: { parent?: string }) {
  const body: AnyRecord = { title: task.title }
  if (task.due_date) body.due = new Date(task.due_date + 'T12:00:00').toISOString()
  if (task.description) body.notes = task.description
  const qs = opts?.parent ? `?${new URLSearchParams({ parent: opts.parent })}` : ''
  return googleRequest(token, `/lists/${listId}/tasks${qs}`, { method: 'POST', body: JSON.stringify(body) })
}
function updateGoogleTask(token: string, listId: string, googleTaskId: string, task: AnyRecord) {
  const body = {
    title: task.title,
    notes: task.description ?? '',
    due:   task.due_date ? new Date(task.due_date + 'T12:00:00').toISOString() : null,
  }
  return googleRequest(token, `/lists/${listId}/tasks/${googleTaskId}`, { method: 'PATCH', body: JSON.stringify(body) })
}
const completeGoogleTask = (token: string, listId: string, id: string) =>
  googleRequest(token, `/lists/${listId}/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
const reopenGoogleTask = (token: string, listId: string, id: string) =>
  googleRequest(token, `/lists/${listId}/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'needsAction', completed: null }) })
const deleteGoogleTask = (token: string, listId: string, id: string) =>
  googleRequest(token, `/lists/${listId}/tasks/${id}`, { method: 'DELETE' })
function moveGoogleTask(token: string, listId: string, id: string, opts: { destinationTasklist?: string; parent?: string }) {
  const qs = new URLSearchParams()
  if (opts.destinationTasklist) qs.set('destinationTasklist', opts.destinationTasklist)
  if (opts.parent) qs.set('parent', opts.parent)
  const suffix = qs.toString() ? `?${qs}` : ''
  return googleRequest(token, `/lists/${listId}/tasks/${id}/move${suffix}`, { method: 'POST' })
}
function getGoogleTask(token: string, listId: string, id: string) {
  return googleRequest(token, `/lists/${listId}/tasks/${id}`)
}
const googleDueToLocalDate = (due: string): string => due.slice(0, 10)

// ── Local-side list/parent resolution (mirrors googleTasksOutbox.ts) ───────
// A read error here used to be indistinguishable from "no row found" — both
// left `data` null and fell through to the default/undefined fallback,
// silently mis-resolving a task's real list/parent on a transient DB
// failure rather than surfacing it.
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
async function fetchTask(taskId: string): Promise<AnyRecord | null> {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle()
  if (error) throw error
  return data
}
async function patchOutboxPayload(rowId: string, payload: AnyRecord): Promise<void> {
  const { error } = await supabase.from('google_tasks_outbox').update({ payload }).eq('id', rowId)
  if (error) throw error
}
async function applySnapshot(taskId: string, userId: string, remote: AnyRecord, clear = false) {
  const { error } = await supabase.rpc('apply_google_task_snapshot', {
    p_task_id: taskId,
    p_google_task_id: clear ? null : remote.id,
    p_google_updated_at: remote.updated ?? null,
    p_google_etag: remote.etag ?? null,
    p_google_position: remote.position ?? null,
    p_google_web_view_link: remote.webViewLink ?? null,
    p_google_links: remote.links ?? null,
    p_google_hidden: remote.hidden ?? false,
    p_google_deleted: remote.deleted ?? false,
    p_clear_google_task_id: clear,
    p_user_id: userId,
  })
  if (error) throw error
}

// ── Outbox drain (push local → Google) ──────────────────────────────────────
// Same three operations as googleTasksOutbox.ts's browser drain, but this
// one respects next_retry_at (the browser's manual drain deliberately
// ignores it — "a human just asked for it"); the scheduled poller has no
// such urgency and must not hammer a task that's mid-backoff.
interface OutboxRow { id: string; user_id: string; task_id: string; operation: 'create' | 'update' | 'delete'; payload: AnyRecord; attempts: number }

// Migration 079's stale-delete-safety net. UNLIKE the browser drain's
// version (a real user JWT, so auth.uid() resolves the caller), this
// service-role caller has NO JWT at all — effective_user_id(p_user_id)
// returns p_user_id verbatim for service_role, and NULL if it's omitted.
// Passing p_user_id here is not optional: without it the UPDATE's
// `user_id = v_user_id` becomes `user_id = NULL`, which matches ZERO rows
// (real bug, caught in review) — the clear would silently no-op on every
// single cron-drained delete, leaving 079's whole stale-delete guard dead
// on this path while still working from the browser.
async function clearGoogleTaskIdIfMatches(taskId: string, expectedGoogleTaskId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('clear_google_task_id_if_matches', {
    p_task_id: taskId, p_expected_google_task_id: expectedGoogleTaskId, p_user_id: userId,
  })
  if (error) throw error
  return !!data
}

// Mirrors src/features/todo/api/googleTasksOutboxRules.ts's
// shouldSkipPendingCreate() exactly — Deno can't import that file (no
// _shared/ imports per this repo's edge-function convention), so keep any
// change to that logic mirrored here by hand.
function shouldSkipPendingCreate(task: AnyRecord, forceRecreate: boolean): boolean {
  // Opt-out is absolute — never bypassed, not even by forceRecreate.
  if (!task.google_sync_enabled) return true
  // Already created — skip, don't duplicate. forceRecreate bypasses ONLY
  // this guard (a Reopen's google_task_id is known-dead).
  if (task.google_task_id && !forceRecreate) return true
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// processCreate — checkpoint-in-place, never a second outbox row. Mirrors
// src/features/todo/api/googleTasksOutbox.ts's processCreate exactly; see
// that file's header comment for the full rationale (a second outbox row
// for cleanup sorts AFTER the original row under 079's per-task FIFO claim
// and could never be claimed while the original is still outstanding — a
// design bug, not a rare edge case, found reviewing this exact function a
// second time). Every state transition — "a remote task now exists" /
// "that remote task must be deleted, not adopted" — is checkpointed into
// THIS row's own payload via patchOutboxPayload, never a new row.
async function processCreate(token: string, userId: string, row: OutboxRow): Promise<void> {
  let remote = row.payload.created_remote_task as AnyRecord | undefined
  const wasReused = !!remote
  // The list a checkpointed remote task actually lives in — resolved ONCE
  // at create time and checkpointed alongside created_remote_task (mirrors
  // googleTasksOutbox.ts exactly; see that file's comment on this same
  // variable for the full rationale — re-resolving on every retry could
  // point at a list the task has since MOVED to, which processUpdate's own
  // moveGoogleTask branch handles separately).
  let listId = row.payload.created_remote_tasklist as string | undefined

  if (remote && row.payload.abandon) {
    try {
      await deleteGoogleTask(token, listId!, remote.id)
    } catch (err) {
      if (!isGoogleTaskNotFound(err)) throw err
    }
    return // cleanup landed — the drain loop deletes this row, done.
  }

  if (!remote) {
    const task = await fetchTask(row.task_id)
    if (!task) return // hard-deleted since this row was enqueued — nothing to create
    if (shouldSkipPendingCreate(task, !!row.payload.force_recreate)) return

    listId = await resolveGoogleListId(task.google_tasklist_id)
    const parent = await resolveGoogleParentId(task.parent_task_id)
    remote = (await createGoogleTask(token, listId, task, { parent }))!

    try {
      await patchOutboxPayload(row.id, { ...row.payload, created_remote_task: remote, created_remote_tasklist: listId })
    } catch (checkpointError) {
      await supabase.from('app_error_logs').insert({
        user_id: userId, message: `Failed to checkpoint Google Task create: ${(checkpointError as Error).message}`,
        context: { taskId: row.task_id },
      }).then(() => {}, () => {})
      await patchOutboxPayload(row.id, { ...row.payload, created_remote_task: remote, created_remote_tasklist: listId, abandon: true }).catch(() => {
        // Best-effort — see googleTasksOutbox.ts's identical comment: if
        // THIS also fails, the next retry just re-POSTs from scratch,
        // matching Google Tasks' own documented no-client-id limitation.
      })
      throw checkpointError
    }
  }

  // Re-check the LIVE row every time before adopting remote — the user (or
  // another write door) can cancel/opt out while the create was in flight,
  // or between retries of a checkpointed row.
  const { data: liveTask, error: liveTaskError } = await supabase
    .from('tasks').select('id, google_sync_enabled, status').eq('id', row.task_id).maybeSingle()
  if (liveTaskError) throw liveTaskError
  const stillWantsThisTask = !!liveTask && liveTask.google_sync_enabled && liveTask.status !== 'cancelled'

  if (!stillWantsThisTask) {
    try {
      await deleteGoogleTask(token, listId!, remote.id)
      return
    } catch (err) {
      if (isGoogleTaskNotFound(err)) return
      await patchOutboxPayload(row.id, { ...row.payload, created_remote_task: remote, created_remote_tasklist: listId, abandon: true })
      throw err
    }
  }

  const task = await fetchTask(row.task_id)

  // In-flight-edit gap fixed (mirrors the browser drain exactly): a local
  // edit landing between the original POST and this retry finally
  // persisting the id would otherwise never reach Google — the DB trigger
  // only enqueues an 'update' row once google_task_id is actually set.
  // Pushing a fresh PATCH with the task's CURRENT fields on every
  // reused-checkpoint pass closes that window.
  if (wasReused && task) {
    remote = (await updateGoogleTask(token, listId!, remote.id, task))!
  }

  await applySnapshot(row.task_id, userId, remote)

  if (task?.status === 'done') {
    const completed = await completeGoogleTask(token, listId!, remote.id)
    await applySnapshot(row.task_id, userId, completed!)
  }
}

async function processUpdate(token: string, userId: string, row: OutboxRow): Promise<void> {
  const task = await fetchTask(row.task_id)
  if (!task || !task.google_task_id) return

  const prevParent   = (row.payload.prev_parent_task_id as string | null | undefined) ?? null
  const prevTasklist = (row.payload.prev_google_tasklist_id as string | null | undefined) ?? null
  const parentChanged   = task.parent_task_id !== prevParent
  const tasklistChanged = task.google_tasklist_id !== prevTasklist
  const currentListId = await resolveGoogleListId(task.google_tasklist_id)

  if (parentChanged || tasklistChanged) {
    const originListId = tasklistChanged ? await resolveGoogleListId(prevTasklist) : currentListId
    const parent = await resolveGoogleParentId(task.parent_task_id)

    // Idempotent-move check (mirrors googleTasksOutbox.ts exactly): a retry
    // of this branch used to call moveGoogleTask again unconditionally,
    // even when an earlier attempt's move already landed and only a LATER
    // step failed. tasks.move has no documented no-op guarantee when
    // already at the target — skip the call entirely once confirmed there.
    const currentRemote = await getGoogleTask(token, originListId, task.google_task_id)
    const alreadyAtTarget = ((currentRemote?.parent ?? null) === (parent ?? null)) && !tasklistChanged
    const moved = alreadyAtTarget
      ? currentRemote
      : await moveGoogleTask(token, originListId, task.google_task_id, {
          destinationTasklist: tasklistChanged ? currentListId : undefined, parent,
        })
    await applySnapshot(task.id, userId, moved!)
  }

  const patched = await updateGoogleTask(token, currentListId, task.google_task_id, task)
  if (task.status === 'done' && patched!.status !== 'completed') {
    await applySnapshot(task.id, userId, (await completeGoogleTask(token, currentListId, task.google_task_id))!)
  } else if (task.status !== 'done' && patched!.status === 'completed') {
    await applySnapshot(task.id, userId, (await reopenGoogleTask(token, currentListId, task.google_task_id))!)
  } else {
    await applySnapshot(task.id, userId, patched!)
  }
}

async function processDelete(token: string, userId: string, row: OutboxRow) {
  const googleTaskId = row.payload.google_task_id as string | undefined
  if (!googleTaskId) return
  const listId = await resolveGoogleListId((row.payload.google_tasklist_id as string | null) ?? null)
  try {
    await deleteGoogleTask(token, listId, googleTaskId)
  } catch (err) {
    if (!isGoogleTaskNotFound(err)) throw err
  }
  // Migration 079's stale-delete-safety net — only clears the local id if
  // it STILL matches what THIS delete targeted (mirrors googleTasksOutbox.ts
  // exactly; no longer the unconditional apply_google_task_snapshot(p_clear_
  // google_task_id=true) call, which had no such guard).
  await clearGoogleTaskIdIfMatches(row.task_id, googleTaskId, userId)
}

// Claims via FOR UPDATE SKIP LOCKED (migration 073) rather than a plain
// SELECT — this poller and the browser's real-time drain can otherwise both
// pick up the SAME pending row (a genuine race, not hypothetical: Google's
// own HTTP round-trip is exactly where the window lives) and both call
// Google for the same 'create', producing a real duplicate task.
async function drainOutbox(token: string, userId: string): Promise<{ drained: number; failed: number }> {
  const { data: rows, error } = await supabase.rpc('claim_google_tasks_outbox', {
    p_respect_backoff: true, p_user_id: userId,
  })
  if (error) throw error

  let drained = 0, failed = 0
  for (const row of (rows ?? []) as OutboxRow[]) {
    try {
      if (row.operation === 'create')      await processCreate(token, userId, row)
      else if (row.operation === 'update') await processUpdate(token, userId, row)
      else                                 await processDelete(token, userId, row)
      // The row delete's own error is now checked (real gap fixed): a
      // failure here used to still increment `drained`, hiding the fact
      // that the outbox row (and any checkpoint state it carried) was
      // still sitting there — falling through to the catch below instead
      // schedules a real retry.
      const { error: deleteError } = await supabase.from('google_tasks_outbox').delete().eq('id', row.id)
      if (deleteError) throw deleteError
      drained++
    } catch (e) {
      failed++
      const attempts = row.attempts + 1
      const backoffSeconds = Math.min(3600, 30 * 2 ** attempts)
      await supabase.from('google_tasks_outbox').update({
        attempts, last_error: (e as Error).message,
        next_retry_at: new Date(Date.now() + backoffSeconds * 1000).toISOString(),
        claimed_at: null, // release the claim so a later retry can pick it up again
      }).eq('id', row.id)
    }
  }
  return { drained, failed }
}

// ── Pull (Google → local) ───────────────────────────────────────────────────
// Also reconciles STALE lists: a list deleted on Google's side used to keep
// its local row forever (upsert-only, nothing ever removed it) — every
// future run then kept including it in the target set and erroring on it,
// and since the sync-state watermark only advances on a fully clean run
// (see below), one deleted list would freeze it PERMANENTLY. Returns the
// confirmed current rows so pullTasks builds its target set from THIS
// fetch, never a second query that could race with the delete below.
//
// Before dropping a stale list's row, every task that belonged to it is
// DETACHED (google_task_id/google_tasklist_id/google_sync_enabled all
// cleared together — migration 074). A Task has no identity independent of
// its list in this API (every endpoint addresses one via
// /lists/{tasklist}/tasks/{task}), so ON DELETE SET NULL alone (clearing
// only google_tasklist_id) would leave a real google_task_id pointing at a
// task that only ever existed inside the now-deleted list — the next PATCH
// against '@default' (resolveGoogleListId's fallback) 404s every time.
async function syncGoogleTaskLists(token: string, userId: string): Promise<{ id: string; google_id: string }[]> {
  const [lists, defaultList] = await Promise.all([fetchGoogleTaskLists(token), fetchDefaultGoogleTaskList(token)])

  const localRows: { id: string; google_id: string }[] = []
  for (const l of lists) {
    const { data } = await supabase.from('google_task_lists').upsert({
      user_id: userId, google_id: l.id, title: l.title,
      is_default: l.id === defaultList.id, google_etag: l.etag, google_updated_at: l.updated,
    }, { onConflict: 'user_id,google_id' }).select('id, google_id').maybeSingle()
    if (data) localRows.push(data)
  }

  const { data: existing } = await supabase.from('google_task_lists').select('id, google_id').eq('user_id', userId)
  const currentGoogleIds = new Set(lists.map((l: AnyRecord) => l.id))
  const staleIds = (existing ?? []).filter((row: AnyRecord) => !currentGoogleIds.has(row.google_id)).map((row: AnyRecord) => row.id)
  for (const staleId of staleIds) {
    const { error: detachError } = await supabase.rpc('detach_tasks_from_deleted_google_list', {
      p_google_tasklist_id: staleId, p_user_id: userId,
    })
    if (detachError) throw detachError
  }
  if (staleIds.length) {
    await supabase.from('google_task_lists').delete().in('id', staleIds)
  }

  return localRows
}

async function upsertOne(rt: AnyRecord, userId: string, googleTasklistLocalId: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('upsert_task_from_google', {
    p_google_task_id: rt.id, p_title: rt.title, p_notes: rt.notes ?? null,
    p_due_date: rt.due ? googleDueToLocalDate(rt.due) : null, p_status: rt.status,
    p_google_updated_at: rt.updated, p_google_tasklist_id: googleTasklistLocalId,
    p_completed_at: rt.completed ?? null, p_google_etag: rt.etag ?? null,
    p_google_position: rt.position ?? null, p_google_web_view_link: rt.webViewLink ?? null,
    p_google_hidden: rt.hidden ?? false, p_google_deleted: rt.deleted ?? false,
    p_user_id: userId,
  })
  if (error) throw error
  return data as string | null
}

// Per-list isolation (the google-health-sync lesson, applied here too): if
// the user ever has multiple Google Task lists, one list's transient error
// must not blank out every other list's otherwise-successful pull in the
// same run — each list gets its own try/catch, and the caller decides
// whether ANY per-list error should hold back the sync-state watermark.
async function pullTasks(token: string, userId: string, sinceIso: string | null): Promise<{ imported: number; listErrors: AnyRecord }> {
  const lists = await syncGoogleTaskLists(token, userId)
  const targets = lists.length ? lists : [{ id: null as string | null, google_id: '@default' }]

  let imported = 0
  const listErrors: AnyRecord = {}
  for (const list of targets) {
    try {
      // A 60s look-back absorbs clock skew / request-boundary edge cases —
      // upsert_task_from_google is idempotent on google_task_id, so
      // re-processing a handful of already-seen tasks is harmless.
      const remoteTasks = sinceIso
        ? await incrementalGoogleTasksSync(token, list.google_id, new Date(new Date(sinceIso).getTime() - 60_000).toISOString())
        : await fullGoogleTasksSync(token, list.google_id)

      for (const rt of remoteTasks) {
        const localId = await upsertOne(rt, userId, list.id)
        if (localId) imported++
      }
      // Every task gets a parent resolution pass, not just the ones WITH a
      // `parent` — a task moved back to top-level on Google's side (parent
      // removed) still needs its LOCAL parent_task_id cleared to match;
      // `continue`-ing past that case (the original bug here) left it stuck
      // showing as a subtask forever. Resolved via the DB (not a batch-local
      // map) so an incremental sync's parent — synced in an EARLIER run —
      // still resolves correctly, not only within one delta.
      for (const rt of remoteTasks) {
        const { data: child } = await supabase.from('tasks').select('id').eq('user_id', userId).eq('google_task_id', rt.id).maybeSingle()
        if (!child?.id) continue
        let parentLocalId: string | null = null
        if (rt.parent) {
          const { data: parent } = await supabase.from('tasks').select('id').eq('user_id', userId).eq('google_task_id', rt.parent).maybeSingle()
          if (!parent?.id) continue // named a parent we haven't synced yet — don't clear a real one on a lookup miss
          parentLocalId = parent.id
        }
        await supabase.rpc('set_task_parent_from_google', { p_task_id: child.id, p_parent_task_id: parentLocalId, p_user_id: userId })
      }
    } catch (e) {
      listErrors[list.google_id] = (e as Error).message
    }
  }
  return { imported, listErrors }
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'))
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors })

  const secret = Deno.env.get('GOOGLE_TASKS_SYNC_SECRET')
  const syncSecretHeader = req.headers.get('x-sync-secret')
  let userId: string | null = null
  if (secret && syncSecretHeader === secret) {
    userId = Deno.env.get('HEVY_USER_ID') ?? null
  } else {
    const authHeader = req.headers.get('authorization') ?? ''
    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    userId = user?.id ?? null
  }
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })

  const syncedAt = new Date().toISOString()
  async function recordState(patch: AnyRecord) {
    await supabase.from('google_tasks_sync_state').upsert({ user_id: userId, ...patch, updated_at: syncedAt }, { onConflict: 'user_id' })
  }
  async function fail(status: number, error: string, reconnect = false) {
    await recordState({ last_error: error, last_error_at: syncedAt })
    await supabase.from('app_error_logs').insert({ user_id: userId, message: `google-tasks-sync: ${error}`, context: { reconnect } }).then(() => {}, () => {})
    return new Response(JSON.stringify({ error, reconnect_required: reconnect }), { status, headers: jsonHeaders })
  }

  const { data: tokenRow } = await supabase.from('user_calendar_tokens').select('refresh_token').eq('user_id', userId).single()
  if (!tokenRow?.refresh_token) return fail(401, 'not_connected — use Connect Google in the app', true)

  // Full-scope refresh (no down-scoping needed — see the header comment).
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: tokenRow.refresh_token,
      client_id:     Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      grant_type:    'refresh_token',
    }),
  })
  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({} as AnyRecord))
    const reconnect = err.error === 'invalid_grant'
    return fail(reconnect ? 401 : 502, `token refresh failed: ${err.error ?? tokenRes.status}`, reconnect)
  }
  const { access_token } = await tokenRes.json()

  // Per-step isolation (the google-health-sync lesson: one failing step must
  // never blank out an otherwise-successful run) — drain and pull are
  // independent concerns, each recorded separately.
  const errors: AnyRecord = {}
  let drainResult = { drained: 0, failed: 0 }
  let imported = 0

  try { drainResult = await drainOutbox(access_token, userId) }
  catch (e) { errors.drain = (e as Error).message }

  try {
    const { data: state } = await supabase.from('google_tasks_sync_state').select('last_success_at').eq('user_id', userId).maybeSingle()
    const result = await pullTasks(access_token, userId, state?.last_success_at ?? null)
    imported = result.imported
    if (Object.keys(result.listErrors).length) errors.pull = result.listErrors
  } catch (e) { errors.pull = (e as Error).message }

  const errorKeys = Object.keys(errors)
  // The watermark only advances when the run was clean end-to-end. A partial
  // pull (one list failed) must NOT advance it — doing so would silently
  // skip that list's missed window forever, since the next run's updatedMin
  // starts from this run's timestamp regardless of what actually got
  // processed. (This differs from google-health-sync's per-metric
  // last_success_at, which advances on any partial success — safe there
  // because each metric's OWN watermark is really just "now", not a
  // precondition for correctly bounding the next fetch.)
  await recordState({
    ...(errorKeys.length === 0 ? { last_success_at: syncedAt } : {}),
    last_error: errorKeys.length ? JSON.stringify(errors) : null,
    last_error_at: errorKeys.length ? syncedAt : null,
  })

  return new Response(JSON.stringify({
    ok: errorKeys.length === 0, drained: drainResult.drained, drain_failed: drainResult.failed,
    imported, ...(errorKeys.length ? { partial_errors: errors } : {}),
  }), { status: 200, headers: jsonHeaders })
})
