// ─────────────────────────────────────────────────────────────────────────────
//  Google Tasks — pure rules, import-free so scripts/verify-google-tasks.cjs
//  can run them via sucrase. The block between the <google-tasks-rules>
//  markers is copied by hand into supabase/functions/google-tasks-sync/
//  index.ts (an edge function can't import it): edit it here, copy it there;
//  the verify script fails when the two differ. API reference:
//  docs/integrations/google-tasks.md.
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Browser-only rules ───────────────────────────────────────────────────────

/** A run (the cron's or this app's) at most this often from the app itself. */
export const GOOGLE_TASKS_BACKGROUND_EVERY_MS = 10 * 60_000

/** Whether the app should start a background sync: Google is connected here
 *  and the server's last attempt (any outcome) is older than the interval. */
export function shouldBackgroundSync(lastAttemptIso: string | null | undefined, nowMs: number, connected: boolean): boolean {
  if (!connected) return false
  const last = Date.parse(lastAttemptIso ?? '')
  return !Number.isFinite(last) || nowMs - last >= GOOGLE_TASKS_BACKGROUND_EVERY_MS
}

export interface GoogleTaskLink {
  label: string
  url:   string
}

/** Google's read-only `links` on a task (a task made from a Gmail message
 *  links to that email): `[{ type, description, link }]`. Only http(s) links
 *  are kept — the data comes from outside the app. */
export function googleTaskLinks(links: unknown): GoogleTaskLink[] {
  if (!Array.isArray(links)) return []
  const out: GoogleTaskLink[] = []
  for (const item of links) {
    if (!item || typeof item !== 'object') continue
    const { type, description, link } = item as Record<string, unknown>
    if (typeof link !== 'string' || !/^https?:\/\//i.test(link)) continue
    const text = typeof description === 'string' ? description.trim() : ''
    out.push({ label: type === 'email' ? 'Open email' : text || 'Open link', url: link })
  }
  return out
}

/** One sync run as the server reports it (google-tasks-sync's answer). */
export interface GoogleTasksSyncSummary {
  ok?:           boolean
  mode?:         'full' | 'incremental'
  drained?:      number
  drain_failed?: number
  imported?:     number
  added?:        number
  /** The same run's Google Calendar read-back: changes applied to slots and plans. */
  readback?:     { applied?: number } | null
  partial_errors?: unknown
}

/** "Push to Google Tasks": the open tasks not on Google Tasks yet that
 *  belong there. An item saved since 155 says where it lives (`google_target`):
 *  only Tasks / Both are pushed — never one kept off Google or on Calendar
 *  only (a repeat's day on Calendar would show twice). An older row (no
 *  target) is pushed as before, except a project's task (162: not on Google
 *  until the owner plans it). */
export function googleTasksPushCandidates<T extends {
  status: string; google_task_id?: string | null; google_target?: string | null; project_id?: string | null
}>(tasks: readonly T[], isOpen: (t: T) => boolean): T[] {
  return tasks.filter(t => !t.google_task_id && isOpen(t) && (t.google_target
    ? t.google_target === 'tasks' || t.google_target === 'both'
    : !t.project_id))
}

/** The toast after "Sync now". */
export function googleTasksSyncMessage(r: GoogleTasksSyncSummary): string {
  const added = r.added ?? 0
  const sent = r.drained ?? 0
  const parts = [
    added > 0 ? `${added} new from Google` : null,
    sent > 0 ? `${sent} change${sent === 1 ? '' : 's'} sent` : null,
  ].filter(Boolean)
  const head = parts.length ? `Google Tasks synced · ${parts.join(' · ')}` : 'Google Tasks synced · nothing new'
  return r.ok === false ? `${head} (some steps failed — see Settings → Subscriptions)` : head
}

/** How the server's last runs went, for the status line under the buttons:
 *  never ran · ok · ok with a step that failed (same run) · failed (the
 *  newest attempt failed after the last good one). */
export type GoogleTasksSyncHealth =
  | { kind: 'never' }
  | { kind: 'ok'; at: string }
  | { kind: 'partial'; at: string; error: string }
  | { kind: 'failed'; at: string; error: string; lastSuccessAt: string | null }

export function googleTasksSyncHealth(state: {
  last_success_at: string | null; last_error: string | null; last_error_at: string | null
} | null | undefined): GoogleTasksSyncHealth {
  if (!state) return { kind: 'never' }
  const okAt = Date.parse(state.last_success_at ?? '')
  const errAt = Date.parse(state.last_error_at ?? '')
  const error = (state.last_error ?? '').trim()
  if (error && Number.isFinite(errAt)) {
    if (Number.isFinite(okAt) && okAt === errAt) return { kind: 'partial', at: state.last_success_at!, error }
    if (!Number.isFinite(okAt) || errAt > okAt) return { kind: 'failed', at: state.last_error_at!, error, lastSuccessAt: state.last_success_at }
  }
  return Number.isFinite(okAt) ? { kind: 'ok', at: state.last_success_at! } : { kind: 'never' }
}
