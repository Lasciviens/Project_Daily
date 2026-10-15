// google-tasks-sync — Phase 3 background poller for the Google Tasks
// integration (migration 071/072). Runs on a pg_cron schedule (migration
// 072, every 20 minutes) so a task added/edited/completed directly in the
// Google Tasks app (phone widget, Assistant, the Tasks web UI) reaches this
// app without anyone opening it — the missing piece Phase 1/2 left: those
// shipped real-time local→Google sync (the outbox, drained on every local
// mutation) and a manual pull button, but nothing that runs unattended.
//
// It also drains the Google CALENDAR outbox (migration 135): a time block
// deleted on the server queues its linked Calendar event there, and this run
// deletes it with the same token; since 155 a linked slot changed on the
// server is queued as an 'upsert' and its event brought up to date — see the
// "Calendar outbox" section below. Last, the Google Calendar read-back (155):
// changes the owner made in Google Calendar to events the app linked come
// back to their items (a sync token on the primary calendar).
//
// Self-contained (no supabase/functions/_shared/ import) per this repo's
// established Hevy-functions convention — Deno Dashboard deploys don't
// bundle sibling files. This means the Google Tasks REST helpers below are
// a deliberate, acknowledged duplicate of src/features/todo/api/
// googleTasksApi.ts's browser-side versions. If the Tasks API surface
// changes, update both.
//
// Auth: EITHER a real user JWT (the app's "Sync now" on Settings →
// Subscriptions, and its background run when the app opens — both through
// supabase.functions.invoke) OR the shared secret header
// `x-sync-secret: <GOOGLE_TASKS_SYNC_SECRET>` (the cron schedule). Deploy
// with "Enforce JWT Verification" OFF — same reason as every function
// listed in supabase/config.toml.
//
// Body (optional): { full: true } reads every list in full now; { force: true }
// also retries outbox rows that are waiting out a backoff. Without them the
// run reads in full once a day (google_tasks_sync_state.last_full_sync_at,
// migration 145) and otherwise only what Google changed since the last clean
// run. Since this is now the app's only Google → app pull, the browser has no
// copy of it to keep in step.
//
// Token: reuses the ONE Google refresh token stored by calendar-oauth in
// user_calendar_tokens. UNLIKE google-health-sync, no down-scoping is
// needed here — the Health API's mixed-scope rejection (403
// DISALLOWED_OAUTH_SCOPES) is a Health-API-specific restriction; Calendar
// and Tasks scopes coexist on one token fine (calendar-token already mints
// full-scope tokens for Calendar without issue). A refresh without a `scope`
// parameter returns every scope the consent granted, calendar.events
// included — which is what lets the Calendar outbox drain reuse it.
//
// Why the migration-071 RPCs needed a migration-072 change to be callable
// from here: they scope writes via `user_id = (SELECT auth.uid())`, which
// is NULL for a service-role caller (no user JWT on that connection at
// all). Every RPC call below passes p_user_id explicitly; the RPC honors it
// only when auth.role() = 'service_role' (a claim only the platform's own
// service key can present) — see migration 072's header comment.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.107.0'

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

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

// The block between the <google-tasks-rules> markers is a HAND MIRROR of
// src/features/todo/api/googleTasksRules.ts — edit it there, then copy the
// block here; scripts/verify-google-tasks.cjs fails when they differ.

// <google-tasks-rules>
/** Google's `due` is a date: "only date information is recorded; the time
 *  portion of the timestamp is discarded". It comes back as midnight UTC of
 *  that date, so the date part IS the day — converting it to a local time
 *  read as the day before anywhere west of UTC. */
export function googleDueToDate(due: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(due ?? '')
  return m ? m[1] : null
}

/** A local day (YYYY-MM-DD) as Google's `due`: midnight UTC of that day. */
export function dateToGoogleDue(date: string | null | undefined): string | null {
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T00:00:00.000Z` : null
}

/** What a failed Tasks API call means for the owner. */
export type GoogleTasksFailureKind = 'auth' | 'scope' | 'api_disabled' | 'rate_limit' | 'not_found' | 'other'

/** The machine-readable reasons in a Google error body:
 *  `{ error: { errors: [{ reason }], details: [{ reason }] } }` — e.g. a token
 *  without the Tasks scope answers 403 with `insufficientPermissions` and
 *  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. Anything else reads as no reasons. */
export function googleErrorReasons(body: unknown): string[] {
  const err = body && typeof body === 'object' ? (body as Record<string, unknown>).error : null
  if (!err || typeof err !== 'object') return []
  const out: string[] = []
  for (const key of ['errors', 'details']) {
    const list = (err as Record<string, unknown>)[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const reason = item && typeof item === 'object' ? (item as Record<string, unknown>).reason : null
      if (typeof reason === 'string') out.push(reason)
    }
  }
  return out
}

/** HTTP status + reasons → kind. Never a guess from the message text. */
export function googleTasksFailureKind(status: number, reasons: readonly string[]): GoogleTasksFailureKind {
  const has = (...r: string[]) => r.some(x => reasons.includes(x))
  if (status === 401) return 'auth'
  if (status === 404) return 'not_found'
  if (has('ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions')) return 'scope'
  if (has('SERVICE_DISABLED', 'accessNotConfigured')) return 'api_disabled'
  if (status === 429 || has('rateLimitExceeded', 'userRateLimitExceeded', 'RATE_LIMIT_EXCEEDED')) return 'rate_limit'
  return 'other'
}

/** The error text the owner reads (toast, Settings → Subscriptions, Errors). */
export function googleTasksFailureText(kind: GoogleTasksFailureKind, status: number, apiMessage?: string | null): string {
  switch (kind) {
    case 'auth': return 'Google sign-in expired: reconnect Google in Settings → Subscriptions'
    case 'scope': return 'Google Tasks access was not granted: reconnect Google in Settings → Subscriptions and allow Tasks'
    case 'api_disabled': return 'The Google Tasks API is turned off for this app\'s Google Cloud project'
    case 'rate_limit': return 'Google Tasks is busy (rate limit): the next sync tries again'
    default: {
      const detail = (apiMessage ?? '').trim()
      return `Google Tasks error ${status}${detail ? `: ${detail}` : ''}`
    }
  }
}

/** Every list is read in full again once the last full read is this old. */
export const GOOGLE_TASKS_FULL_EVERY_MS = 24 * 60 * 60 * 1000
/** An incremental read starts this long before the last clean run (clock skew). */
export const GOOGLE_TASKS_LOOKBACK_MS = 60_000

export type GoogleTasksPullPlan = { mode: 'full' } | { mode: 'incremental'; updatedMin: string }

/** Full or incremental for this run. Full: asked for ("Sync now"), never
 *  synced cleanly, or no clean full read in the last day (before migration 145
 *  there is no last_full_sync_at, so every run is full). Incremental: tasks
 *  Google changed since the last clean run, minus the look-back. */
export function googleTasksPullPlan(
  state: { last_success_at?: string | null; last_full_sync_at?: string | null } | null | undefined,
  nowMs: number,
  forceFull = false,
): GoogleTasksPullPlan {
  const lastSuccess = Date.parse(state?.last_success_at ?? '')
  const lastFull = Date.parse(state?.last_full_sync_at ?? '')
  if (forceFull || !Number.isFinite(lastSuccess) || !Number.isFinite(lastFull) || nowMs - lastFull >= GOOGLE_TASKS_FULL_EVERY_MS) {
    return { mode: 'full' }
  }
  return { mode: 'incremental', updatedMin: new Date(lastSuccess - GOOGLE_TASKS_LOOKBACK_MS).toISOString() }
}
// </google-tasks-rules>

const TASKS_BASE = 'https://www.googleapis.com/tasks/v1'

// Mirrors src/features/todo/api/googleTasksApi.ts's GoogleTasksApiError /
// isGoogleTaskNotFound exactly — Deno can't import that file (no _shared/
// imports per this repo's edge-function convention), so keep any change to
// this class mirrored here by hand. Carries the real HTTP status so "was
// this task genuinely deleted, or did the request merely fail?" is decided
// on the status, never a message substring match.
class GoogleTasksApiError extends Error {
  readonly status: number
  readonly kind: GoogleTasksFailureKind
  constructor(status: number, message: string, kind: GoogleTasksFailureKind = googleTasksFailureKind(status, [])) {
    super(message)
    this.name = 'GoogleTasksApiError'
    this.status = status
    this.kind = kind
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
  if (!res.ok) {
    const kind = googleTasksFailureKind(res.status, googleErrorReasons(data))
    throw new GoogleTasksApiError(res.status, googleTasksFailureText(kind, res.status, data?.error?.message), kind)
  }
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
// Completed, hidden (cleared, or completed in Google's own apps — those come
// back only with showHidden) and deleted tasks too: a pull mirrors every
// state change, not only open tasks. Assigned tasks (from Docs or Chat,
// `showAssigned`) are left out on purpose — see docs/integrations/google-tasks.md.
const listTasks = (token: string, listId: string, updatedMin?: string) =>
  paginateTasks(token, listId, {
    showCompleted: 'true', showHidden: 'true', showDeleted: 'true',
    ...(updatedMin ? { updatedMin } : {}),
  })

function createGoogleTask(token: string, listId: string, task: AnyRecord, opts?: { parent?: string }) {
  const body: AnyRecord = { title: task.title }
  const due = dateToGoogleDue(task.due_date)
  if (due) body.due = due
  if (task.description) body.notes = task.description
  const qs = opts?.parent ? `?${new URLSearchParams({ parent: opts.parent })}` : ''
  return googleRequest(token, `/lists/${listId}/tasks${qs}`, { method: 'POST', body: JSON.stringify(body) })
}
function updateGoogleTask(token: string, listId: string, googleTaskId: string, task: AnyRecord) {
  const body = {
    title: task.title,
    notes: task.description ?? '',
    due:   dateToGoogleDue(task.due_date),
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
async function drainOutbox(token: string, userId: string, force: boolean): Promise<{ drained: number; failed: number }> {
  const { data: rows, error } = await supabase.rpc('claim_google_tasks_outbox', {
    p_respect_backoff: !force, p_user_id: userId,
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
// Mirrors Google's lists into google_task_lists and returns the confirmed
// rows, which of them are new (a new list is read in full whatever the
// run's plan — an incremental read would miss its older tasks) and the lists
// that could not be mirrored. One list's failure no longer hides silently:
// it used to be dropped from the run with no error at all (the upsert's
// error was never read), so its tasks never arrived — exactly what Google's
// duplicate list names did against migration 076's title index (dropped in
// 145).
//
// Also reconciles STALE lists: a list deleted on Google's side used to keep
// its local row forever (upsert-only, nothing ever removed it). Before
// dropping a stale list's row, every task that belonged to it is DETACHED
// (google_task_id/google_tasklist_id/google_sync_enabled all cleared
// together — migration 074): a Task has no identity independent of its list
// in this API (every endpoint addresses one via /lists/{tasklist}/tasks/
// {task}), so a google_task_id left behind would 404 on every later write.
interface ListMirror {
  rows:   { id: string; google_id: string }[]
  newIds: Set<string>
  errors: AnyRecord
}

async function syncGoogleTaskLists(token: string, userId: string): Promise<ListMirror> {
  const [lists, defaultList] = await Promise.all([fetchGoogleTaskLists(token), fetchDefaultGoogleTaskList(token)])

  const { data: before, error: beforeError } = await supabase.from('google_task_lists').select('id, google_id').eq('user_id', userId)
  if (beforeError) throw beforeError
  const knownGoogleIds = new Set((before ?? []).map((r: AnyRecord) => r.google_id as string))

  const mirror: ListMirror = { rows: [], newIds: new Set(), errors: {} }
  for (const l of lists) {
    const { data, error } = await supabase.from('google_task_lists').upsert({
      user_id: userId, google_id: l.id, title: l.title ?? '',
      is_default: l.id === defaultList.id, google_etag: l.etag, google_updated_at: l.updated,
    }, { onConflict: 'user_id,google_id' }).select('id, google_id').single()
    if (error || !data) {
      mirror.errors[l.id] = `list not mirrored: ${errorText(error ?? 'no row returned')}`
      continue
    }
    mirror.rows.push(data)
    if (!knownGoogleIds.has(l.id)) mirror.newIds.add(data.id)
  }

  const currentGoogleIds = new Set(lists.map((l: AnyRecord) => l.id))
  const staleIds = (before ?? []).filter((row: AnyRecord) => !currentGoogleIds.has(row.google_id)).map((row: AnyRecord) => row.id)
  for (const staleId of staleIds) {
    const { error: detachError } = await supabase.rpc('detach_tasks_from_deleted_google_list', {
      p_google_tasklist_id: staleId, p_user_id: userId,
    })
    if (detachError) throw detachError
  }
  if (staleIds.length) {
    const { error: deleteError } = await supabase.from('google_task_lists').delete().in('id', staleIds).eq('user_id', userId)
    if (deleteError) throw deleteError
  }

  return mirror
}

// google task id → local task id for every task already linked to Google:
// resolves `parent` without a query per task (and across runs — an
// incremental read's parent may have synced long ago). Paged: PostgREST
// returns at most 1,000 rows.
async function loadLinkedTaskIds(userId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('tasks').select('id, google_task_id')
      .eq('user_id', userId).not('google_task_id', 'is', null)
      .order('id').range(from, from + 999)
    if (error) throw error
    for (const row of (data ?? []) as AnyRecord[]) out.set(row.google_task_id, row.id)
    if (!data || data.length < 1000) return out
  }
}

async function upsertOne(rt: AnyRecord, userId: string, googleTasklistLocalId: string | null, parentLocalId: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('upsert_task_from_google', {
    p_google_task_id: rt.id, p_title: typeof rt.title === 'string' ? rt.title : '', p_notes: rt.notes ?? null,
    p_due_date: googleDueToDate(rt.due), p_status: rt.status,
    p_google_updated_at: rt.updated ?? null, p_google_tasklist_id: googleTasklistLocalId,
    p_parent_task_id: parentLocalId,
    p_completed_at: rt.completed ?? null, p_google_etag: rt.etag ?? null,
    p_google_position: rt.position ?? null, p_google_web_view_link: rt.webViewLink ?? null,
    p_google_hidden: rt.hidden ?? false, p_google_deleted: rt.deleted ?? false,
    p_user_id: userId,
    p_google_links: Array.isArray(rt.links) ? rt.links : null,
  })
  if (error) throw error
  return data as string | null
}

interface PullResult {
  imported:   number
  added:      number
  /** Lists that could not be mirrored or read: they hold the watermark back. */
  listErrors: AnyRecord
  /** Single tasks that failed: reported, but they don't hold the watermark
   *  back — a task that always fails would otherwise freeze every later run,
   *  and the daily full read retries it anyway. */
  taskErrors: string[]
}

// Per-list and per-task isolation: one list that can't be read, or one task
// whose write fails, no longer stops the rest (a single failing task used to
// end its whole list's run, every run).
async function pullTasks(token: string, userId: string, plan: GoogleTasksPullPlan): Promise<PullResult> {
  const mirror = await syncGoogleTaskLists(token, userId)
  const result: PullResult = { imported: 0, added: 0, listErrors: { ...mirror.errors }, taskErrors: [] }
  const linked = await loadLinkedTaskIds(userId)

  for (const list of mirror.rows) {
    try {
      // A list new to the mirror is read in full, whatever the plan.
      const updatedMin = plan.mode === 'incremental' && !mirror.newIds.has(list.id) ? plan.updatedMin : undefined
      const remoteTasks = await listTasks(token, list.google_id, updatedMin)

      // Pass 1: every task, with its parent when that is already known.
      const parentLater: AnyRecord[] = []
      for (const rt of remoteTasks) {
        try {
          const parentLocalId = rt.parent ? linked.get(rt.parent) : null
          const isNew = !linked.has(rt.id)
          const localId = await upsertOne(rt, userId, list.id, parentLocalId ?? null)
          if (!localId) continue
          result.imported++
          if (isNew) result.added++
          linked.set(rt.id, localId)
          if (rt.parent && parentLocalId === undefined) parentLater.push(rt)
        } catch (e) {
          result.taskErrors.push(`task ${rt.id}: ${errorText(e)}`)
        }
      }
      // Pass 2: children whose parent came in during pass 1. A parent that
      // still isn't known is left alone — never cleared on a lookup miss.
      for (const rt of parentLater) {
        const parentLocalId = linked.get(rt.parent)
        if (!parentLocalId) continue
        const { error } = await supabase.rpc('set_task_parent_from_google', {
          p_task_id: linked.get(rt.id), p_parent_task_id: parentLocalId, p_user_id: userId,
        })
        if (error) result.taskErrors.push(`task ${rt.id} parent: ${errorText(error)}`)
      }
    } catch (e) {
      result.listErrors[list.google_id] = errorText(e)
    }
  }
  return result
}

// ── Calendar outbox (Google Calendar, migration 135) ────────────────────────
// A time block deleted on the server — ai-proxy's db_delete, the Hevy
// functions closing a planned-session task, the tasks → time_blocks ON
// DELETE CASCADE, migration 043's cleanup triggers — has no Google token at
// hand, so its linked Calendar event used to stay on the calendar forever.
// Migration 135's AFTER DELETE trigger queues each deleted block's event in
// calendar_outbox; this step deletes them with the same access token the
// Tasks steps use. The browser still removes an event itself before it
// deletes the block, so most queued rows simply read 404/410 here and go.
//
// Since 155 a row may also be an 'upsert': a linked slot or plan changed on
// the server (the assistant, a Google Tasks pull renaming its task, Hevy
// closing a session, any task ticked done or reopened — the "✓ "), and this
// step PATCHes the event from the row as it is now.
//
// The block between the <calendar-outbox-rules> markers is a HAND MIRROR of
// src/features/calendar/calendarOutboxRules.ts — edit it there, then copy the
// block here; scripts/verify-calendar-outbox.cjs fails when they differ.

// <calendar-outbox-rules>
/** What the drain does with a queued row once Google answered its delete:
 *  'deleted' — removed now; drop the row.
 *  'gone'    — Google no longer has it (404, or 410 "Resource has been
 *              deleted" for an event already in the calendar's bin); drop the
 *              row. Most rows end here: a browser delete removes the event
 *              before the block, and the trigger queues it anyway.
 *  'stop'    — 401/403/429: the token, its scopes or the rate limit would
 *              fail every other row the same way. Back this row off and end
 *              the run; the rest wait for the next one.
 *  'retry'   — anything else (5xx, other 4xx, no answer at all): back this
 *              row off and carry on with the next. */
export type CalendarOutboxOutcome = 'deleted' | 'gone' | 'stop' | 'retry'

/** Google Calendar events.delete → outcome. `null` = no HTTP answer (a
 *  network failure or a timeout). */
export function calendarDeleteOutcome(status: number | null): CalendarOutboxOutcome {
  if (status === null || !Number.isFinite(status)) return 'retry'
  if (status >= 200 && status < 300) return 'deleted'
  if (status === 404 || status === 410) return 'gone'
  if (status === 401 || status === 403 || status === 429) return 'stop'
  return 'retry'
}

/** After this many failures a row is parked: tried once a day, so a delete
 *  that always fails (a 400, a 403 for that one event) neither retries hourly
 *  forever nor stops every run ahead of the rows behind it. */
export const CALENDAR_PARK_AFTER = 8

/** Seconds a failed row waits before its next try — the Tasks outbox's own
 *  curve (google-tasks-sync's drainOutbox): 60 s after the first failure,
 *  doubling, never more than an hour; a day once parked. `attempts` counts
 *  this failure too. */
export function calendarRetryDelaySeconds(attempts: number): number {
  const n = Number.isFinite(attempts) && attempts >= 1 ? Math.floor(attempts) : 1
  if (n >= CALENDAR_PARK_AFTER) return 86_400
  return Math.min(3600, 30 * 2 ** n)
}

/** PostgREST / Postgres saying the table isn't there — migration 135 not
 *  applied yet. The drain then skips quietly instead of failing every run
 *  (the same three signals as wishesApi.ts and the other pre-migration guards). */
export function isMissingTableError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /Could not find the table/i.test(error.message ?? '')
}

/** The events.delete path, encoded the way the browser's calendarApi.ts does. */
export function calendarEventPath(calendarId: string, eventId: string): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`
}

export interface CalendarOutboxRow {
  id: string
  calendar_id: string
  event_id: string
  attempts: number
  /** 'delete' (135) or 'upsert' (155); missing = delete. */
  operation?: 'delete' | 'upsert'
  /** The request this run read (155): the row is removed only while it still holds it. */
  requested_at?: string
}

/** One run's tally — google-tasks-sync returns it as `calendar`. */
export interface CalendarDrainSummary {
  /** Removed from Google by this run. */
  deleted: number
  /** Google answered 404/410: it was gone already (usually the browser's own delete). */
  already_gone: number
  /** A live time block or repeating plan (147) still points at the event (one put back, a shared id) — it stays. */
  kept: number
  /** Backed off; tried again on a later run. */
  failed: number
  /** Not tried this run (after a stop, or out of time). */
  left: number
  /** Why the run stopped early (401/403/429), else null. */
  stopped: string | null
  /** Rows that reached CALENDAR_PARK_AFTER failures this run (now tried daily). */
  parked: number
  /** Upserts (155): events brought up to date. */
  patched: number
  /** Upserts with nothing left to push (no live slot or plan holds the event any more). */
  untracked: number
}

export function emptyCalendarDrainSummary(): CalendarDrainSummary {
  return { deleted: 0, already_gone: 0, kept: 0, failed: 0, left: 0, stopped: null, parked: 0, patched: 0, untracked: 0 }
}

/** The I/O a run needs — google-tasks-sync wires these to Google and Supabase. */
export interface CalendarDrainDeps {
  /** Event ids a live time block or repeating plan still points at: never deleted. */
  stillLinked: ReadonlySet<string>
  /** One events.delete. Resolves (never rejects) with the HTTP status, or null with no answer. */
  deleteEvent(row: CalendarOutboxRow): Promise<{ status: number | null; message: string }>
  /** One events.patch from the live row (155); null = no live slot or plan holds the event any more. */
  patchEvent?(row: CalendarOutboxRow): Promise<{ status: number | null; message: string } | null>
  removeRow(row: CalendarOutboxRow): Promise<void>
  backOff(row: CalendarOutboxRow, attempts: number, delaySeconds: number, message: string): Promise<void>
  /** False once the run should start no further deletes (its time budget). */
  timeLeft?: () => boolean
}

/** Readable text for anything thrown — a supabase-js error is a plain object
 *  with a `message`, not always an Error. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

/** One row: null when it is settled (its row removed), else why it failed. */
async function settleCalendarRow(
  row: CalendarOutboxRow,
  deps: CalendarDrainDeps,
  summary: CalendarDrainSummary,
): Promise<string | null> {
  if (row.operation === 'upsert') {
    const pushed = deps.patchEvent ? await deps.patchEvent(row) : null
    if (pushed === null) {
      await deps.removeRow(row)
      summary.untracked++
      return null
    }
    const result = calendarDeleteOutcome(pushed.status)
    if (result === 'deleted' || result === 'gone') {
      // Gone on Google: the read-back turns the item's Calendar presence off.
      await deps.removeRow(row)
      if (result === 'deleted') summary.patched++
      else summary.already_gone++
      return null
    }
    const why = pushed.message || `Calendar API ${pushed.status ?? 'unreachable'}`
    if (result === 'stop') summary.stopped = why
    return why
  }
  if (deps.stillLinked.has(row.event_id)) {
    await deps.removeRow(row)
    summary.kept++
    return null
  }
  const answer = await deps.deleteEvent(row)
  const outcome = calendarDeleteOutcome(answer.status)
  if (outcome === 'deleted' || outcome === 'gone') {
    await deps.removeRow(row)
    if (outcome === 'deleted') summary.deleted++
    else summary.already_gone++
    return null
  }
  const message = answer.message || `Calendar API ${answer.status ?? 'unreachable'}`
  if (outcome === 'stop') summary.stopped = message
  return message
}

/** Works through one batch in order. Never rejects: a row whose step fails is
 *  backed off and counted, and the next row goes on (unless it was a stop). */
export async function drainCalendarRows(
  rows: readonly CalendarOutboxRow[],
  deps: CalendarDrainDeps,
): Promise<CalendarDrainSummary> {
  const summary = emptyCalendarDrainSummary()
  for (let i = 0; i < rows.length; i++) {
    if (summary.stopped !== null || (deps.timeLeft && !deps.timeLeft())) {
      summary.left = rows.length - i
      break
    }
    const row = rows[i]
    // A failed removeRow lands in the catch too, even after Google deleted
    // the event — the next run then reads 410 and drops the row.
    const failure = await settleCalendarRow(row, deps, summary).catch(errorText)
    if (failure === null) continue
    summary.failed++
    const attempts = row.attempts + 1
    if (attempts === CALENDAR_PARK_AFTER) summary.parked++
    try {
      await deps.backOff(row, attempts, calendarRetryDelaySeconds(attempts), failure)
    } catch {
      // The row keeps its old retry time and is simply tried again next run.
    }
  }
  return summary
}
// </calendar-outbox-rules>

// The block between the <calendar-event-rules> markers is a HAND MIRROR of
// src/features/calendar/calendarEventRules.ts (migration 155: a slot's event,
// and what a change read back from Google Calendar means) — edit it there,
// then copy the block here; scripts/verify-calendar-event-rules.cjs fails when
// they differ.

// <calendar-event-rules>
/** "Do it at 14:00" has no length: Google gets a short Free event (a
 *  zero-length one risks 400 timeRangeEmpty). Also the slot's stored length. */
export const NOMINAL_EVENT_MINUTES = 15
/** In front of a done item's event title (owner, 15.10.2026); Undo takes it off. */
export const DONE_MARK = '✓ '
/** The zone a server-side push uses (time_blocks keeps none): the owner's. */
export const SERVER_EVENT_TIME_ZONE = 'Europe/Oslo'

/** The event title: "✓ " in front once the item is done (never twice). */
export function calendarTitle(title: string | null | undefined, done: boolean): string {
  const clean = stripDoneMark(title ?? '')
  return done ? `${DONE_MARK}${clean}` : clean
}

/** A title as the app keeps it: without the done mark Google shows. */
export function stripDoneMark(summary: string | null | undefined): string {
  let s = (summary ?? '').trim()
  while (s.startsWith('✓')) s = s.slice(1).trim()
  return s
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const CLOCK = /^(\d{2}):(\d{2})(?::(\d{2}))?/

/** 'yyyy-MM-dd' + n days (calendar arithmetic, no time zone involved). */
export function addDaysToIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** 'HH:MM[:SS]' → minutes after midnight, or null. */
export function clockMinutes(t: string | null | undefined): number | null {
  const m = CLOCK.exec(t ?? '')
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return Number(m[1]) * 60 + Number(m[2])
}

const pad = (n: number) => String(n).padStart(2, '0')

/** A wall-clock date-time `minutes` after `day` 00:00 (may roll into later days). */
export function wallClockAt(day: string, minutes: number): string {
  const days = Math.floor(minutes / 1440)
  const rest = minutes - days * 1440
  return `${addDaysToIso(day, days)}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}:00`
}

/** The columns of a slot (time_blocks) its event is made from. */
export interface EventBlock {
  date: string
  start_time: string | null
  duration_minutes: number
  title: string | null
  /** false: no length — Free on Google (155). Missing before 155 = busy. */
  busy?: boolean | null
}

export type EventTime = { date: string } | { dateTime: string; timeZone: string }

/** What events.insert / events.patch get for a slot. */
export interface BlockEventBody {
  summary: string
  start: EventTime
  end: EventTime
  transparency: 'opaque' | 'transparent'
}

/**
 * The Google event of a slot: a day with no time is an all-day event (end =
 * the next day — Google's end is exclusive) and Free; a time is a wall-clock
 * dateTime in `timeZone` (DST-safe), Busy when the slot has a length, Free
 * with a nominal end when it doesn't. null when the slot has no usable day.
 */
export function blockEventBody(b: EventBlock, opts: { done: boolean; timeZone: string }): BlockEventBody | null {
  if (!ISO_DAY.test(b.date ?? '')) return null
  const summary = calendarTitle(b.title, opts.done)
  const start = clockMinutes(b.start_time)
  if (start === null) {
    return { summary, start: { date: b.date }, end: { date: addDaysToIso(b.date, 1) }, transparency: 'transparent' }
  }
  const busy = b.busy !== false
  const length = Math.min(1440, Math.max(1, Math.round(Number(b.duration_minutes) || (busy ? 60 : NOMINAL_EVENT_MINUTES))))
  const timeZone = opts.timeZone && opts.timeZone.trim() ? opts.timeZone : SERVER_EVENT_TIME_ZONE
  return {
    summary,
    start: { dateTime: wallClockAt(b.date, start), timeZone },
    end: { dateTime: wallClockAt(b.date, start + length), timeZone },
    transparency: busy ? 'opaque' : 'transparent',
  }
}

// ── The read-back (google-tasks-sync) ───────────────────────────────────────

/** The fields of a Google event the read-back reads (events.list, singleEvents=false). */
export interface GoogleEventLike {
  id?: string
  status?: string
  summary?: string
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  transparency?: string
  recurringEventId?: string
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string }
  updated?: string
}

/** One change as apply_calendar_readback (migration 155) takes it. */
export interface ReadbackEvent {
  id: string
  seriesId: string | null
  status: 'confirmed' | 'tentative' | 'cancelled'
  title: string | null
  allDay: boolean
  date: string | null
  time: string | null
  minutes: number | null
  busy: boolean
  originalDate: string | null
  updated: string | null
}

/** An RFC 3339 instant as the wall clock in `timeZone` ({ date, time 'HH:MM:SS' }). */
export function wallClockIn(instant: string, timeZone: string): { date: string; time: string } | null {
  const ms = Date.parse(instant)
  if (!Number.isFinite(ms)) return null
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms))
  } catch {
    return null
  }
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}:${get('second')}` }
}

const dayOf = (t: { date?: string; dateTime?: string; timeZone?: string } | undefined, zone: string): string | null => {
  if (!t) return null
  if (t.date && ISO_DAY.test(t.date)) return t.date
  if (t.dateTime) return wallClockIn(t.dateTime, t.timeZone || zone)?.date ?? null
  return null
}

/**
 * A Google event as the change the read-back applies. Times are read as the
 * wall clock of the event's own zone (else the calendar's), the length from
 * the two instants (an all-day event: whole days), the title without "✓ ".
 * A cancelled entry may carry only its id (and, for one day of a series,
 * recurringEventId + originalStartTime — Google's reference). null for
 * something with no id.
 */
export function readbackEvent(e: GoogleEventLike, calendarZone: string): ReadbackEvent | null {
  if (!e || typeof e.id !== 'string' || !e.id) return null
  const zone = (e.start?.timeZone || calendarZone || SERVER_EVENT_TIME_ZONE)
  const seriesId = typeof e.recurringEventId === 'string' && e.recurringEventId ? e.recurringEventId : null
  const originalDate = dayOf(e.originalStartTime, e.originalStartTime?.timeZone || zone)
  const status = e.status === 'cancelled' ? 'cancelled' : e.status === 'tentative' ? 'tentative' : 'confirmed'
  const base = { id: e.id, seriesId, originalDate, updated: typeof e.updated === 'string' ? e.updated : null }
  if (status === 'cancelled') {
    return { ...base, status, title: null, allDay: false, date: null, time: null, minutes: null, busy: false }
  }
  const title = typeof e.summary === 'string' ? stripDoneMark(e.summary) : null
  const busy = e.transparency !== 'transparent'
  if (e.start?.date && ISO_DAY.test(e.start.date)) {
    const endDay = e.end?.date && ISO_DAY.test(e.end.date) ? e.end.date : addDaysToIso(e.start.date, 1)
    const days = Math.max(1, Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${e.start.date}T00:00:00Z`)) / 86_400_000))
    return { ...base, status, title, allDay: true, date: e.start.date, time: null, minutes: Math.min(1440, days * 1440), busy: false }
  }
  const startAt = e.start?.dateTime ? wallClockIn(e.start.dateTime, zone) : null
  if (!startAt) return { ...base, status, title, allDay: false, date: null, time: null, minutes: null, busy }
  const startMs = Date.parse(e.start!.dateTime!)
  const endMs = e.end?.dateTime ? Date.parse(e.end.dateTime) : NaN
  const minutes = Number.isFinite(endMs) && endMs > startMs ? Math.min(1440, Math.round((endMs - startMs) / 60_000)) : null
  return { ...base, status, title, allDay: false, date: startAt.date, time: startAt.time, minutes, busy }
}

/** The first read (and the one after a 410) only fetches a sync token. */
export type ReadbackPlan = { mode: 'baseline' } | { mode: 'incremental'; syncToken: string }

export function readbackPlan(state: { sync_token?: string | null } | null | undefined): ReadbackPlan {
  const token = state?.sync_token
  return typeof token === 'string' && token ? { mode: 'incremental', syncToken: token } : { mode: 'baseline' }
}

/** How far back the baseline reads (it only needs the token at its end). */
export const READBACK_BASELINE_DAYS = 7
/** Pages a run reads at most (2500 events each). */
export const READBACK_MAX_PAGES = 20

/**
 * events.list parameters. Google: "Sync tokens aren't compatible with most
 * filters" — timeMin goes on the baseline only; with a syncToken no
 * timeMin/timeMax/updatedMin/orderBy/q, and showDeleted can't be false (it is
 * left out on both, so both requests carry the same set otherwise). A page
 * repeats the same query with its pageToken.
 */
export function readbackListParams(plan: ReadbackPlan, nowMs: number, pageToken?: string | null): Record<string, string> {
  const params: Record<string, string> = { maxResults: '2500' }
  if (plan.mode === 'incremental') params.syncToken = plan.syncToken
  else params.timeMin = new Date(nowMs - READBACK_BASELINE_DAYS * 86_400_000).toISOString()
  if (pageToken) params.pageToken = pageToken
  return params
}

/** 410 Gone on a sync token: Google wants a fresh full sync. */
export function isSyncTokenGone(status: number | null | undefined): boolean {
  return status === 410
}
// </calendar-event-rules>

const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3'
// At most CALENDAR_BATCH rows a run, and no new delete once CALENDAR_BUDGET_MS
// has passed: with the 20-minute cron that is up to 150 events an hour, and a
// run that meets a hanging Google can't outlive the function's wall clock.
const CALENDAR_BATCH = 50
const CALENDAR_BUDGET_MS = 25_000
const CALENDAR_REQUEST_TIMEOUT_MS = 10_000

type CalendarStepResult = CalendarDrainSummary & { skipped?: 'not_migrated' }

// The same request as the browser's calendarApi.ts deleteCalendarEvent
// (DELETE, no query parameters), but answering with the status instead of
// throwing, so the rules above decide what it means.
async function deleteCalendarEventOnce(token: string, calendarId: string, eventId: string): Promise<{ status: number | null; message: string }> {
  try {
    const res = await fetch(`${CALENDAR_BASE}${calendarEventPath(calendarId, eventId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(CALENDAR_REQUEST_TIMEOUT_MS),
    })
    const text = await res.text().catch(() => '')
    if (res.ok) return { status: res.status, message: '' }
    let detail = ''
    try { detail = JSON.parse(text)?.error?.message ?? '' } catch { /* not JSON */ }
    return { status: res.status, message: `Calendar API ${res.status}${detail ? `: ${detail}` : ''}` }
  } catch (e) {
    return { status: null, message: `Calendar API unreachable: ${errorText(e)}` }
  }
}

// The same request as the browser's calendarApi.ts updateCalendarEvent
// (PATCH, JSON body), answering with the status instead of throwing.
async function patchCalendarEventOnce(token: string, calendarId: string, eventId: string, body: AnyRecord): Promise<{ status: number | null; message: string }> {
  try {
    const res = await fetch(`${CALENDAR_BASE}${calendarEventPath(calendarId, eventId)}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALENDAR_REQUEST_TIMEOUT_MS),
    })
    const text = await res.text().catch(() => '')
    if (res.ok) return { status: res.status, message: '' }
    let detail = ''
    try { detail = JSON.parse(text)?.error?.message ?? '' } catch { /* not JSON */ }
    return { status: res.status, message: `Calendar API ${res.status}${detail ? `: ${detail}` : ''}` }
  } catch (e) {
    return { status: null, message: `Calendar API unreachable: ${errorText(e)}` }
  }
}

type QueuedRow = CalendarOutboxRow & { payload?: AnyRecord }

// An upsert (155): the event from the row that holds it NOW — a slot (its
// day, time, length, Busy/Free, "✓ " when its task is done; Oslo's wall
// clock, time_blocks keeps no zone) or a plan's series (its title only: the
// rule itself is the app's — calendar/calendarSeries.ts). null = no live
// slot or plan holds it any more (nothing to push).
async function patchQueuedEvent(token: string, userId: string, row: QueuedRow): Promise<{ status: number | null; message: string } | null> {
  if (row.payload?.series) {
    const { data: plan, error } = await supabase.from('schedule_blocks')
      .select('id, title').eq('user_id', userId).eq('google_calendar_event_id', row.event_id).limit(1).maybeSingle()
    if (error) throw error
    if (!plan) return null
    return patchCalendarEventOnce(token, row.calendar_id, row.event_id, { summary: stripDoneMark(plan.title) })
  }
  const { data: block, error } = await supabase.from('time_blocks')
    .select('id, date, start_time, duration_minutes, title, busy, task:tasks(status)')
    .eq('user_id', userId).eq('google_calendar_event_id', row.event_id).limit(1).maybeSingle()
  if (error) throw error
  if (!block) return null
  const body = blockEventBody(block as unknown as EventBlock, {
    done: (block as AnyRecord).task?.status === 'done', timeZone: SERVER_EVENT_TIME_ZONE,
  })
  if (!body) return null
  return patchCalendarEventOnce(token, row.calendar_id, row.event_id, { ...body })
}

async function drainCalendarOutbox(token: string, userId: string): Promise<CalendarStepResult> {
  const { data, error } = await supabase.from('calendar_outbox')
    .select('id, calendar_id, event_id, attempts, operation, requested_at, payload')
    .eq('user_id', userId)
    // The two operations there are (135's delete, 155's upsert) — named, so a
    // later one can never be read as either.
    .in('operation', ['delete', 'upsert'])
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(CALENDAR_BATCH)
  if (error) {
    // Pre-migration-safe: before 135 there is nothing to drain — say so
    // instead of failing every run. Before 155 there is no requested_at:
    // the delete rows are read as 135 has them.
    if (isMissingTableError(error)) return { ...emptyCalendarDrainSummary(), skipped: 'not_migrated' }
    if (error.code === '42703' || error.code === 'PGRST204') return drainCalendarDeletesBefore155(token, userId)
    throw error
  }
  return drainCalendarRowsFor(token, userId, (data ?? []) as QueuedRow[])
}

async function drainCalendarDeletesBefore155(token: string, userId: string): Promise<CalendarStepResult> {
  const { data, error } = await supabase.from('calendar_outbox')
    .select('id, calendar_id, event_id, attempts')
    .eq('user_id', userId)
    .eq('operation', 'delete')
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(CALENDAR_BATCH)
  if (error) throw error
  return drainCalendarRowsFor(token, userId, (data ?? []) as QueuedRow[])
}

async function drainCalendarRowsFor(token: string, userId: string, rows: QueuedRow[]): Promise<CalendarStepResult> {
  if (!rows.length) return emptyCalendarDrainSummary()

  // Never delete an event a live block still points at: a block put back
  // after its delete, or a second block holding the same id. Every linked
  // event is in the primary calendar, so the event id alone decides.
  const eventIds = [...new Set(rows.filter((r) => r.operation !== 'upsert').map((r) => r.event_id))]
  let linked: AnyRecord[] = []
  let linkedPlans: AnyRecord[] = []
  if (eventIds.length) {
    const { data: linkedBlocks, error: linkedError } = await supabase.from('time_blocks')
      .select('google_calendar_event_id')
      .eq('user_id', userId)
      .in('google_calendar_event_id', eventIds)
    if (linkedError) throw linkedError
    linked = linkedBlocks ?? []
    // …nor one a live repeating plan points at (its series, migration 147).
    // Before 147 no plan can hold one: a missing column reads as none.
    const { data: linkedPlanRows, error: linkedPlansError } = await supabase.from('schedule_blocks')
      .select('google_calendar_event_id')
      .eq('user_id', userId)
      .in('google_calendar_event_id', eventIds)
    if (linkedPlansError && linkedPlansError.code !== '42703' && linkedPlansError.code !== 'PGRST204') throw linkedPlansError
    linkedPlans = linkedPlanRows ?? []
  }

  const stopAt = Date.now() + CALENDAR_BUDGET_MS
  return drainCalendarRows(rows, {
    stillLinked: new Set([...(linked ?? []), ...(linkedPlans ?? [])].map((b: AnyRecord) => b.google_calendar_event_id as string)),
    deleteEvent: (row) => deleteCalendarEventOnce(token, row.calendar_id, row.event_id),
    patchEvent: (row) => patchQueuedEvent(token, userId, row as QueuedRow),
    removeRow: async (row) => {
      // Only the request this run read: one made meanwhile (requested_at
      // moved, 155) stays for the next run.
      let removal = supabase.from('calendar_outbox').delete().eq('id', row.id).eq('user_id', userId)
      if (row.requested_at) removal = removal.eq('requested_at', row.requested_at)
      const { error: deleteError } = await removal
      if (deleteError) throw deleteError
    },
    backOff: async (row, attempts, delaySeconds, message) => {
      const { error: updateError } = await supabase.from('calendar_outbox').update({
        attempts,
        last_error: message.slice(0, 1000),
        next_retry_at: new Date(Date.now() + delaySeconds * 1000).toISOString(),
      }).eq('id', row.id).eq('user_id', userId)
      if (updateError) throw updateError
    },
    timeLeft: () => Date.now() < stopAt,
  })
}

// ── Google Calendar read-back (migration 155) ──────────────────────────────
// Changes the owner makes in Google Calendar come back: a moved or renamed
// one-off event moves / renames its item, one day of a series moved becomes
// that day's own item (142), a deleted event turns the item's Calendar
// presence off (the item stays). Only events whose ids a slot or plan stores
// are acted on (apply_calendar_readback decides, row by row). A sync token on
// the primary calendar (google_calendar_sync_state): the first run, and the
// run after Google answers 410, only takes a token (a baseline) — nothing
// before it is applied. The token moves only when every change was applied.
// Google's rules for all of this: docs/integrations/google-calendar.md.

interface ReadbackSummary {
  mode: 'baseline' | 'incremental' | 'reset'
  read: number
  applied: number
  outcomes: Record<string, number>
  error: string | null
  skipped?: 'not_migrated'
}

async function listCalendarPage(token: string, params: Record<string, string>): Promise<{ status: number; body: AnyRecord | null; message: string }> {
  const qs = new URLSearchParams(params).toString()
  try {
    const res = await fetch(`${CALENDAR_BASE}/calendars/primary/events?${qs}`, {
      headers: { 'Authorization': `Bearer ${token}` },
      signal: AbortSignal.timeout(CALENDAR_REQUEST_TIMEOUT_MS),
    })
    const body = await res.json().catch(() => null) as AnyRecord | null
    return { status: res.status, body, message: res.ok ? '' : `Calendar API ${res.status}${body?.error?.message ? `: ${body.error.message}` : ''}` }
  } catch (e) {
    return { status: 0, body: null, message: `Calendar API unreachable: ${errorText(e)}` }
  }
}

async function readCalendarChanges(token: string, userId: string): Promise<ReadbackSummary> {
  const summary: ReadbackSummary = { mode: 'baseline', read: 0, applied: 0, outcomes: {}, error: null }
  const { data: state, error: stateError } = await supabase.from('google_calendar_sync_state')
    .select('sync_token').eq('user_id', userId).maybeSingle()
  if (stateError) {
    if (isMissingTableError(stateError)) return { ...summary, skipped: 'not_migrated' }
    throw stateError
  }
  const runAt = new Date().toISOString()
  async function record(patch: AnyRecord) {
    const { error } = await supabase.from('google_calendar_sync_state')
      .upsert({ user_id: userId, last_run_at: runAt, ...patch }, { onConflict: 'user_id' })
    if (error) console.error(`google-tasks-sync: calendar read-back state not saved: ${error.message}`)
  }

  let plan = readbackPlan(state as AnyRecord | null)
  summary.mode = plan.mode
  let pageToken: string | null = null
  let zone = SERVER_EVENT_TIME_ZONE
  const items: AnyRecord[] = []
  let nextSyncToken: string | null = null
  let reset = false
  for (let page = 0; page < READBACK_MAX_PAGES; page++) {
    const res = await listCalendarPage(token, readbackListParams(plan, Date.now(), pageToken))
    if (isSyncTokenGone(res.status) && plan.mode === 'incremental' && !reset) {
      // "the client should clear its storage and perform a full
      // synchronization without any syncToken": a new baseline, now.
      reset = true
      summary.mode = 'reset'
      plan = { mode: 'baseline' }
      pageToken = null
      items.length = 0
      page = -1
      continue
    }
    if (res.status < 200 || res.status >= 300 || !res.body) {
      summary.error = res.message || 'Calendar API: no answer'
      await record({ last_error: summary.error, last_error_at: runAt })
      return summary
    }
    if (typeof res.body.timeZone === 'string' && res.body.timeZone) zone = res.body.timeZone
    if (plan.mode === 'incremental') items.push(...(Array.isArray(res.body.items) ? res.body.items : []))
    pageToken = typeof res.body.nextPageToken === 'string' && res.body.nextPageToken ? res.body.nextPageToken : null
    nextSyncToken = typeof res.body.nextSyncToken === 'string' && res.body.nextSyncToken ? res.body.nextSyncToken : null
    if (!pageToken) break
  }
  if (!nextSyncToken) {
    summary.error = pageToken ? `more than ${READBACK_MAX_PAGES} pages of changes — read on the next run` : 'Google sent no sync token'
    await record({ last_error: summary.error, last_error_at: runAt })
    return summary
  }
  summary.read = items.length

  // Only events a slot or plan of this account stores are looked at.
  const changes = items.map((e) => readbackEvent(e as GoogleEventLike, zone)).filter((e): e is ReadbackEvent => e !== null)
  const ids = [...new Set(changes.flatMap((c) => [c.id, c.seriesId].filter((x): x is string => !!x)))]
  const ours = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const [blocks, plans] = await Promise.all([
      supabase.from('time_blocks').select('google_calendar_event_id').eq('user_id', userId).in('google_calendar_event_id', chunk),
      supabase.from('schedule_blocks').select('google_calendar_event_id').eq('user_id', userId).in('google_calendar_event_id', chunk),
    ])
    if (blocks.error) throw blocks.error
    if (plans.error) throw plans.error
    for (const r of [...(blocks.data ?? []), ...(plans.data ?? [])]) ours.add((r as AnyRecord).google_calendar_event_id)
  }
  let failures = 0
  for (const c of changes) {
    if (!ours.has(c.id) && !(c.seriesId && ours.has(c.seriesId))) continue
    const { data: outcome, error } = await supabase.rpc('apply_calendar_readback', { p_user: userId, p_event: c })
    if (error) {
      failures++
      summary.error = `a change not applied: ${error.message}`
      continue
    }
    const key = String(outcome ?? 'unknown')
    summary.outcomes[key] = (summary.outcomes[key] ?? 0) + 1
    if (!['same', 'stale', 'ignored', 'not_ours'].includes(key)) summary.applied++
  }
  if (failures) {
    // The token stays: the next run reads these changes again (applying one twice is a no-op).
    await record({ last_error: summary.error, last_error_at: runAt, last_applied: summary.applied })
    return summary
  }
  await record({
    sync_token: nextSyncToken, last_clean_at: runAt, last_applied: summary.applied,
    last_error: reset ? 'Google reset the Calendar read-back (410): changes made just before it were not read' : null,
    last_error_at: reset ? runAt : null,
  })
  return summary
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
    if (userId && !(await isAppUser(userId))) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, headers: jsonHeaders })
  }
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders })

  const options = await req.json().catch(() => ({})) as AnyRecord
  const forceFull = options?.full === true
  const force = options?.force === true

  const syncedAt = new Date().toISOString()
  const { data: prevState } = await supabase.from('google_tasks_sync_state').select('*').eq('user_id', userId).maybeSingle()
  const prevError = String((prevState as AnyRecord | null)?.last_error ?? '')

  // Writes the run's outcome. last_full_sync_at exists only once migration
  // 145 ran: a write that names it is retried without it, so the rest of the
  // state (the watermark above all) is never lost to an older schema.
  async function recordState(patch: AnyRecord) {
    const row = { user_id: userId, ...patch, updated_at: syncedAt }
    let { error } = await supabase.from('google_tasks_sync_state').upsert(row, { onConflict: 'user_id' })
    if (error && 'last_full_sync_at' in row && (error.code === '42703' || error.code === 'PGRST204')) {
      const { last_full_sync_at: _unused, ...older } = row
      ;({ error } = await supabase.from('google_tasks_sync_state').upsert(older, { onConflict: 'user_id' }))
    }
    if (error) console.error(`google-tasks-sync: sync state not saved: ${error.message}`)
  }
  // Developer → Errors gets a message once, not every 20 minutes while the
  // same problem lasts (last_error still carries it on every run).
  async function logOnce(message: string, context: AnyRecord) {
    if (prevError.includes(message)) return
    await supabase.from('app_error_logs').insert({ user_id: userId, message: `google-tasks-sync: ${message}`, context }).then(() => {}, () => {})
  }
  async function fail(status: number, error: string, reconnect = false) {
    await recordState({ last_error: error, last_error_at: syncedAt })
    await logOnce(error, { reconnect })
    return new Response(JSON.stringify({ error, reconnect_required: reconnect }), { status, headers: jsonHeaders })
  }

  const { data: tokenRow, error: tokenRowError } = await supabase.from('user_calendar_tokens').select('refresh_token').eq('user_id', userId).maybeSingle()
  if (tokenRowError) return fail(500, `could not read the stored Google sign-in: ${tokenRowError.message}`)
  if (!tokenRow?.refresh_token) return fail(401, 'Google is not connected: use Connect Google in Settings → Subscriptions', true)

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
    // invalid_grant: the stored sign-in was revoked or expired. A refresh
    // token dies after 7 days while the Google Cloud consent screen is in
    // Testing (docs/deploy-checklist.md).
    const reconnect = err.error === 'invalid_grant'
    return fail(reconnect ? 401 : 502, reconnect
      ? 'Google refused the stored sign-in (invalid_grant): reconnect Google in Settings → Subscriptions'
      : `token refresh failed: ${err.error ?? tokenRes.status}`, reconnect)
  }
  const { access_token } = await tokenRes.json()

  // Per-step isolation (the google-health-sync lesson: one failing step must
  // never blank out an otherwise-successful run) — drain and pull are
  // independent concerns, each recorded separately.
  const errors: AnyRecord = {}
  let drainResult = { drained: 0, failed: 0 }
  let pull: PullResult = { imported: 0, added: 0, listErrors: {}, taskErrors: [] }
  const plan = googleTasksPullPlan(prevState as AnyRecord | null, Date.now(), forceFull)

  try { drainResult = await drainOutbox(access_token, userId, force) }
  catch (e) { errors.drain = errorText(e) }

  try {
    pull = await pullTasks(access_token, userId, plan)
    if (Object.keys(pull.listErrors).length) errors.pull = pull.listErrors
  } catch (e) { errors.pull = errorText(e) }

  // Calendar outbox (migration 135) — last, so it never delays the Tasks
  // steps above. drainCalendarRows itself never rejects; a throw here is the
  // step failing as a whole (its read of the queue or of time_blocks).
  let calendar: CalendarStepResult = emptyCalendarDrainSummary()
  let calendarError: string | null = null
  try { calendar = await drainCalendarOutbox(access_token, userId) }
  catch (e) { calendarError = errorText(e) }

  // Google Calendar read-back (155) — after the outbox, so the app's own
  // pushes of this run are already on Google when their changes come back.
  let readback: ReadbackSummary | null = null
  let readbackError: string | null = null
  try { readback = await readCalendarChanges(access_token, userId) }
  catch (e) { readbackError = errorText(e) }

  const errorKeys = Object.keys(errors)
  // The watermark only advances when the TASKS steps ran clean end-to-end. A
  // partial pull (one list failed) must NOT advance it — doing so would
  // silently skip that list's missed window forever, since the next run's
  // updatedMin starts from this run's timestamp regardless of what actually
  // got processed. (This differs from google-health-sync's per-metric
  // last_success_at, which advances on any partial success — safe there
  // because each metric's OWN watermark is really just "now", not a
  // precondition for correctly bounding the next fetch.)
  //
  // Single failed tasks (pull.taskErrors) and Calendar trouble are reported
  // next to it (partial_errors, last_error) but never hold it back: the
  // watermark bounds the next Tasks read, which a Calendar failure has
  // nothing to do with, and one task that always fails would otherwise
  // freeze it for good — the daily full read retries that task anyway.
  const calendarProblem = calendarError ?? (calendar.stopped ? `stopped: ${calendar.stopped}` : null)
  const reported: AnyRecord = { ...errors }
  if (pull.taskErrors.length) reported.tasks = pull.taskErrors.slice(0, 5).concat(pull.taskErrors.length > 5 ? [`… ${pull.taskErrors.length - 5} more`] : [])
  if (calendarProblem) reported.calendar = calendarProblem
  const readbackProblem = readbackError ?? (readback?.mode !== 'reset' ? readback?.error : null) ?? null
  if (readbackProblem) reported.readback = readbackProblem
  const reportedKeys = Object.keys(reported)
  const lastError = reportedKeys.length ? describeProblems(reported) : null

  // Problems reach Developer → Errors too (last_error is on Settings →
  // Subscriptions): once per new message, and every Calendar row that has
  // just been parked.
  if (lastError) await logOnce(lastError, { reported, mode: plan.mode })
  if (calendar.parked) {
    await supabase.from('app_error_logs').insert({
      user_id: userId,
      message: `google-tasks-sync: ${calendar.parked} Google Calendar deletion${calendar.parked === 1 ? '' : 's'} failed ${CALENDAR_PARK_AFTER} times — now tried once a day`,
      context: { calendar },
    }).then(() => {}, () => {})
  }
  await recordState({
    ...(errorKeys.length === 0 ? { last_success_at: syncedAt } : {}),
    ...(errorKeys.length === 0 && plan.mode === 'full' ? { last_full_sync_at: syncedAt } : {}),
    last_error: lastError,
    last_error_at: lastError ? syncedAt : null,
  })

  const imported = pull.imported
  return new Response(JSON.stringify({
    ok: reportedKeys.length === 0, mode: plan.mode, drained: drainResult.drained, drain_failed: drainResult.failed,
    added: pull.added, imported, calendar, readback, ...(reportedKeys.length ? { partial_errors: reported } : {}),
  }), { status: 200, headers: jsonHeaders })
})

// "Pull: …; Drain: …" for last_error — read by a person on Settings →
// Subscriptions, so plain text, not the JSON it used to be.
function describeProblems(reported: AnyRecord): string {
  const label: AnyRecord = { drain: 'Sending', pull: 'Reading lists', tasks: 'Tasks', calendar: 'Calendar', readback: 'Calendar changes' }
  return Object.entries(reported).map(([key, value]) => {
    const text = typeof value === 'string' ? value
      : Array.isArray(value) ? value.join('; ')
      : Object.values(value as AnyRecord).map(String).join('; ')
    return `${label[key] ?? key}: ${text}`
  }).join(' · ').slice(0, 1000)
}
