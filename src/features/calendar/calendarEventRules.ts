// ─────────────────────────────────────────────────────────────────────────────
//  One item's Google Calendar event (migration 155) — the PURE rules both the
//  browser and google-tasks-sync use:
//    · the event a slot (time_blocks) becomes: timed or all-day, Busy or
//      Free, "✓ " in front once its task is done;
//    · what a change read back from Google Calendar means for the row
//      (readbackEvent), and how the read-back lists changes (sync token).
//  Google's side, checked against its reference first (15.10.2026):
//  docs/integrations/google-calendar.md.
//
//  Import-free on purpose. The block between the <calendar-event-rules>
//  markers is MIRRORED BY HAND into supabase/functions/google-tasks-sync/
//  index.ts (Deno can't import from src/); edit it here, then copy the block
//  there. scripts/verify-calendar-event-rules.cjs fails when they differ.
// ─────────────────────────────────────────────────────────────────────────────

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

/** What a push sends: 'all' (the slot's day, time, length, Busy/Free and
 *  title) or 'title' (a done mark, a series renamed: ONLY the summary). */
export type EventPushFields = 'all' | 'title'

/**
 * The PATCH a push sends. A title push carries the summary and nothing else,
 * so ticking an item done never sends its old day or time back over a move
 * the owner made in Google Calendar. Anything but 'title' is the whole event.
 */
export function eventPatchFor(body: BlockEventBody, fields: EventPushFields | string | null | undefined): Partial<BlockEventBody> {
  return fields === 'title' ? { summary: body.summary } : body
}

/** The done mark's PATCH: the title with or without "✓ " — and only that. */
export function doneMarkPatch(title: string | null | undefined, done: boolean): { summary: string } {
  return { summary: calendarTitle(title, done) }
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
