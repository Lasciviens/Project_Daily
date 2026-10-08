// ─────────────────────────────────────────────────────────────────────────────
//  Calendar outbox (migration 135) — the PURE half of the drain that removes a
//  deleted time block's Google Calendar event: what Google's answer to the
//  delete means for the queued row, how long a failed row waits, and the loop
//  over one batch (its I/O is passed in, so it runs the same in a test).
//
//  Why it exists: a block deleted on the server (ai-proxy's db_delete, the
//  Hevy functions closing a planned-session task, the tasks → time_blocks
//  cascade, migration 043's cleanup triggers) has no Google token at hand, so
//  its event used to stay on the calendar forever. Migration 135's trigger
//  queues every deleted block's event in calendar_outbox; google-tasks-sync
//  (cron, every 20 minutes) removes them with this code.
//
//  Import-free on purpose. The block between the <calendar-outbox-rules>
//  markers is MIRRORED BY HAND into supabase/functions/google-tasks-sync/
//  index.ts (Deno can't import from src/ — the repo's no-_shared/ rule); edit
//  it here, then copy the block there. scripts/verify-calendar-outbox.cjs
//  fails when the two copies differ.
// ─────────────────────────────────────────────────────────────────────────────

/** The calendar every linked event lives in: UnifiedPlanModal.linkCalendarEvent
 *  creates it in the user's primary calendar, and migration 135's trigger
 *  queues that calendar (time_blocks has no calendar column).
 *  scripts/verify-calendar-outbox.cjs fails when those two stop agreeing. */
export const LINKED_EVENT_CALENDAR_ID = 'primary'

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
}

/** One run's tally — google-tasks-sync returns it as `calendar`. */
export interface CalendarDrainSummary {
  /** Removed from Google by this run. */
  deleted: number
  /** Google answered 404/410: it was gone already (usually the browser's own delete). */
  already_gone: number
  /** A live time block still points at the event (a block put back, a shared id) — it stays. */
  kept: number
  /** Backed off; tried again on a later run. */
  failed: number
  /** Not tried this run (after a stop, or out of time). */
  left: number
  /** Why the run stopped early (401/403/429), else null. */
  stopped: string | null
  /** Rows that reached CALENDAR_PARK_AFTER failures this run (now tried daily). */
  parked: number
}

export function emptyCalendarDrainSummary(): CalendarDrainSummary {
  return { deleted: 0, already_gone: 0, kept: 0, failed: 0, left: 0, stopped: null, parked: 0 }
}

/** The I/O a run needs — google-tasks-sync wires these to Google and Supabase. */
export interface CalendarDrainDeps {
  /** Event ids a live time block still points at: never deleted. */
  stillLinked: ReadonlySet<string>
  /** One events.delete. Resolves (never rejects) with the HTTP status, or null with no answer. */
  deleteEvent(row: CalendarOutboxRow): Promise<{ status: number | null; message: string }>
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
