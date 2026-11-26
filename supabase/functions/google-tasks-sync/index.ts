// google-tasks-sync — Phase 3 background poller for the Google Tasks
// integration (migration 071/072). Runs on a pg_cron schedule (migration
// 072, every 20 minutes) so a task added/edited/completed directly in the
// Google Tasks app (phone widget, Assistant, the Tasks web UI) reaches this
// app without anyone opening it — the missing piece Phase 1/2 left: those
// shipped real-time local→Google sync (the outbox, drained on every local
// mutation) and a manual pull button, but nothing that runs unattended.
//
// Until 25.11.2026 it also drained the Google Calendar outbox (135) and read
// Google Calendar's changes back (155); Google Calendar went then (migration
// 208: the owner's "Calendar only" — Google Tasks stays). Apple Calendar is
// the app's calendar (icloud-calendar).
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
// user_calendar_tokens. A refresh without a `scope` parameter returns every
// scope the consent granted: `tasks` (and, for a sign-in made before
// 25.11.2026, the Calendar scopes too — unused now, gone after a reconnect).
//
// Why the migration-071 RPCs needed a migration-072 change to be callable
// from here: they scope writes via `user_id = (SELECT auth.uid())`, which
// is NULL for a service-role caller (no user JWT on that connection at
// all). Every RPC call below passes p_user_id explicitly; the RPC honors it
// only when auth.role() = 'service_role' (a claim only the platform's own
// service key can present) — see migration 072's header comment.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
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
  serviceKey(),
)

// deno-lint-ignore no-explicit-any
type AnyRecord = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any -- loose outside JSON, read field by field all through this function

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

/** Readable text for anything thrown — a supabase-js error is a plain object
 *  with a `message`, not always an Error. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

// Constant-time secret check (security review 26.10.2026): both sides are
// hashed to the same length first, so the answer time shows neither the
// secret's length nor how much of it matched. Never log either value.
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([hash(given), hash(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ── Handler ──────────────────────────────────────────────────────────────────
// 212: the service refused the stored sign-in — a notice under the bell (and a push, as the owner chose). The database
// builds it from the service code alone (no text, no URL) and writes at most one a day while an unread one is there.
// Best effort: a failure here never changes the answer.
async function notifySignInFailed(db: ReturnType<typeof createClient>, userId: string): Promise<void> {
  const { error } = await db.rpc('notify_service_problem', { p_user: userId, p_service: 'google' })
  if (error) console.error(`google-tasks-sync: the sign-in notice was not written (${error.code ?? 'error'})`)
}

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'))
  const jsonHeaders = { ...cors, 'Content-Type': 'application/json' }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors })

  const secret = Deno.env.get('GOOGLE_TASKS_SYNC_SECRET')
  const syncSecretHeader = req.headers.get('x-sync-secret')
  let userId: string | null = null
  if (secret && await sameSecret(syncSecretHeader ?? '', secret)) {
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
      void _unused
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
    if (reconnect) await notifySignInFailed(supabase, userId)
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
  // Single failed tasks (pull.taskErrors) are reported next to it
  // (partial_errors, last_error) but never hold it back: one task that always
  // fails would otherwise freeze it for good — the daily full read retries
  // that task anyway.
  const reported: AnyRecord = { ...errors }
  if (pull.taskErrors.length) reported.tasks = pull.taskErrors.slice(0, 5).concat(pull.taskErrors.length > 5 ? [`… ${pull.taskErrors.length - 5} more`] : [])
  const reportedKeys = Object.keys(reported)
  const lastError = reportedKeys.length ? describeProblems(reported) : null

  // Problems reach Developer → Errors too (last_error is on Settings →
  // Subscriptions): once per new message.
  if (lastError) await logOnce(lastError, { reported, mode: plan.mode })
  await recordState({
    ...(errorKeys.length === 0 ? { last_success_at: syncedAt } : {}),
    ...(errorKeys.length === 0 && plan.mode === 'full' ? { last_full_sync_at: syncedAt } : {}),
    last_error: lastError,
    last_error_at: lastError ? syncedAt : null,
  })

  const imported = pull.imported
  return new Response(JSON.stringify({
    ok: reportedKeys.length === 0, mode: plan.mode, drained: drainResult.drained, drain_failed: drainResult.failed,
    added: pull.added, imported, ...(reportedKeys.length ? { partial_errors: reported } : {}),
  }), { status: 200, headers: jsonHeaders })
})

// "Pull: …; Drain: …" for last_error — read by a person on Settings →
// Subscriptions, so plain text, not the JSON it used to be.
function describeProblems(reported: AnyRecord): string {
  const label: AnyRecord = { drain: 'Sending', pull: 'Reading lists', tasks: 'Tasks' }
  return Object.entries(reported).map(([key, value]) => {
    const text = typeof value === 'string' ? value
      : Array.isArray(value) ? value.join('; ')
      : Object.values(value as AnyRecord).map(String).join('; ')
    return `${label[key] ?? key}: ${text}`
  }).join(' · ').slice(0, 1000)
}
