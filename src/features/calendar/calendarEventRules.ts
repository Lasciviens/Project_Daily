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
/** The home zone: the zone of an item that names none (made before 183, or by a server writer). The owner's. */
export const SERVER_EVENT_TIME_ZONE = 'Europe/Oslo'
/** An IANA zone name's shape ("Europe/Oslo", "America/Argentina/Buenos_Aires", "Etc/GMT+1") — 183's CHECK. */
export const IANA_ZONE = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/

/**
 * The zone an item's times are in (183): its own when it is a zone this runtime knows, else the home zone. A
 * stored or device value is data — it lands in iCalendar TZID lines and Google's event bodies (the warning in
 * AGENTS.md) — so anything but a real zone name is never used.
 */
export function itemTimeZone(zone: string | null | undefined): string {
  const z = typeof zone === 'string' ? zone.trim() : ''
  if (z && z.length <= 64 && IANA_ZONE.test(z)) {
    try { new Intl.DateTimeFormat('en', { timeZone: z }); return z } catch { /* not a zone this runtime knows */ }
  }
  return SERVER_EVENT_TIME_ZONE
}

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
  /** Where it happens (186): the row's jsonb, read through eventPlace. */
  place?: unknown
  /** Show As (193): 'busy' | 'free', read through eventShowAs; none = by its length, as before. */
  show_as?: unknown
  /** Alert and Second Alert (193), read through eventAlerts; none = the area's own alert. */
  alerts?: unknown
}

// ── An item's calendar fields (193): Alert + Second Alert, Show As, URL, Travel Time ──
//  Every value is input (the warning in AGENTS.md): the browser, the assistant and the read-backs write these columns,
//  and the writers put them into iCalendar lines and Google's bodies. The database CHECKs the same allow-lists
//  (item_alerts_ok, item_url_ok, the travel and show_as CHECKs); the writers read a row through the event* readers
//  below again, and Apple's lines have a last guard of their own (icloudEvents).

/** The alerts an item may have (Apple's own list): minutes before a timed item's start — 0 is "at the time"; on an
 *  all-day item a day offset at 09:00 (allDayAlertDays: 0–120 on the day, 1440 the day before, 2880, 10080 a week). */
export const ALERT_MINUTES: readonly number[] = [0, 5, 10, 15, 30, 60, 120, 1440, 2880, 10080]
/** Alert and Second Alert: at most two, never the same twice. */
export const MAX_ITEM_ALERTS = 2
/** An all-day item's alert rings at this time of its day (minutes after midnight: 09:00, Apple's own default). */
export const ALL_DAY_ALERT_MINUTE = 540
/** Travel Time (193): 0 = none, or minutes before; no value = automatic (Time to Leave, from the place's map pin). */
export const TRAVEL_MINUTES: readonly number[] = [0, 5, 15, 30, 60, 90, 120]
/** A link is at most this long (193's CHECK). */
export const ITEM_URL_MAX = 2048
/** A link an item may hold (193's CHECK, item_url_ok): https, a host name (no user name, no IP literal in brackets), an
 *  optional port, then only URL characters with % followed by two hex digits — no space, quote, angle bracket,
 *  backslash or control character, so nothing in it can end an iCalendar line or a quoted value. */
export const ITEM_URL = /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?::[0-9]{1,5})?(?:[/?#](?:%[0-9A-Fa-f]{2}|[A-Za-z0-9._~!$&'()*+,;=:@/?#-])*)?$/

export type ShowAs = 'busy' | 'free'

/** A row's alerts as the writers may use them: null = not set (the area's own alert, as before 193); [] = none; else
 *  one or two allow-listed, distinct minutes, in their order (Alert, then Second Alert). Anything else reads as not set. */
export function eventAlerts(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ITEM_ALERTS) return null
  if (!raw.every(m => typeof m === 'number' && ALERT_MINUTES.includes(m))) return null
  return new Set(raw).size === raw.length ? [...raw] as number[] : null
}

/** A row's Show As: 'busy' or 'free'; anything else (none, before 193) reads as not set — the length decides. */
export function eventShowAs(raw: unknown): ShowAs | null {
  return raw === 'busy' || raw === 'free' ? raw : null
}

/** A row's link: only one ITEM_URL takes, at most ITEM_URL_MAX long; anything else is no link. */
export function eventUrl(raw: unknown): string | null {
  return typeof raw === 'string' && raw.length <= ITEM_URL_MAX && ITEM_URL.test(raw) ? raw : null
}

/** A row's travel time: 0 (none) or allow-listed minutes; anything else (none, before 193) reads as automatic (null). */
export function eventTravel(raw: unknown): number | null {
  return typeof raw === 'number' && TRAVEL_MINUTES.includes(raw) ? raw : null
}

/** The day offset an all-day item's alert means: on the day (0–120), 1, 2 or 7 days before — each at 09:00. */
export function allDayAlertDays(minutes: number): number {
  return minutes >= 10080 ? 7 : minutes >= 2880 ? 2 : minutes >= 1440 ? 1 : 0
}

/** Busy or Free on a calendar: Show As when set, else as before 193 — Busy with a length, Free without one and all day. */
export function eventTransparency(showAs: unknown, timedWithLength: boolean): 'opaque' | 'transparent' {
  const set = eventShowAs(showAs)
  return (set ? set === 'busy' : timedWithLength) ? 'opaque' : 'transparent'
}

/** Google's reminders (193; Events reference: `reminders.useDefault`, `overrides[]` of `{ method, minutes }`, minutes
 *  "between 0 and 40320", at most 5). */
export interface EventReminders { useDefault: boolean; overrides: { method: 'popup'; minutes: number }[] }
/** The calendar's own default — what an item with no alerts of its own has (and what an update puts back). */
export const DEFAULT_REMINDERS: EventReminders = { useDefault: true, overrides: [] }

/**
 * An item's alerts as Google's reminders (193), or null when it has none of its own (the calendar's default, as before
 * 193). Timed: minutes before the start. All day: Google counts from the day's midnight and takes no minutes after it,
 * so 09:00 the day before is 900 and "on the day at 09:00" can't be said — it is left out (Apple has it).
 */
export function googleReminders(raw: unknown, allDay: boolean): EventReminders | null {
  const alerts = eventAlerts(raw)
  if (!alerts) return null
  const minutes = alerts.map(m => (allDay ? allDayAlertDays(m) * 1440 - ALL_DAY_ALERT_MINUTE : m)).filter(m => m >= 0)
  return { useDefault: false, overrides: [...new Set(minutes)].map(m => ({ method: 'popup' as const, minutes: m })) }
}

/** An item's place as the calendars get it (186): a name, maybe a town, maybe a map pin. */
export interface EventPlace { name: string; locality?: string; lat?: number; lon?: number }

// eslint-disable-next-line no-control-regex -- control characters are exactly what is dropped
const PLACE_CONTROL = /[\x00-\x1F\x7F-\x9F\u2028\u2029]/g
const placeLine = (t: unknown, max: number) => typeof t !== 'string' ? ''
  : Array.from(t.replace(PLACE_CONTROL, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim()
const placeCoord = (n: unknown, limit: number): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit

/**
 * A row's place as the writers may use it (186). The column is checked by the database, but a stored value is still
 * input (the warning in AGENTS.md — it lands in iCalendar lines and Google's bodies): only a name of up to 120
 * characters, a town of up to 80, and coordinates in range are taken; anything else is no place, or no pin.
 */
export function eventPlace(raw: unknown): EventPlace | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const name = placeLine(o.name, 120)
  if (!name) return null
  const out: EventPlace = { name }
  const locality = placeLine(o.locality, 80)
  if (locality && locality.toLowerCase() !== name.toLowerCase()) out.locality = locality
  if (placeCoord(o.lat, 90) && placeCoord(o.lon, 180)) { out.lat = o.lat; out.lon = o.lon }
  return out
}

/** "Jernbanetorget, Oslo": Google's `location`. */
export function placeText(p: EventPlace): string {
  return p.locality ? `${p.name}, ${p.locality}` : p.name
}

export type EventTime = { date: string } | { dateTime: string; timeZone: string }

/** What events.insert / events.patch get for a slot. */
export interface BlockEventBody {
  summary: string
  start: EventTime
  end: EventTime
  transparency: 'opaque' | 'transparent'
  /** The slot's place (186), when it has one. A PATCH of the whole event sends none as null (fullEventPatch). */
  location?: string
  /** The slot's own alerts (193), when it has them. A PATCH of the whole event sends none as the default (fullEventPatch). */
  reminders?: EventReminders
}

/**
 * The Google event of a slot: a day with no time is an all-day event (end =
 * the next day — Google's end is exclusive) and Free; a time is a wall-clock
 * dateTime in `timeZone` (DST-safe), Busy when the slot has a length, Free
 * with a nominal end when it doesn't — unless Show As says (193). Its own
 * alerts are its reminders (193). null when the slot has no usable day.
 */
export function blockEventBody(b: EventBlock, opts: { done: boolean; timeZone: string }): BlockEventBody | null {
  if (!ISO_DAY.test(b.date ?? '')) return null
  const summary = calendarTitle(b.title, opts.done)
  const start = clockMinutes(b.start_time)
  const place = eventPlace(b.place)
  const location = place ? { location: placeText(place) } : {}
  const reminders = googleReminders(b.alerts, start === null)
  const own = reminders ? { reminders } : {}
  if (start === null) {
    return { summary, start: { date: b.date }, end: { date: addDaysToIso(b.date, 1) }, transparency: eventTransparency(b.show_as, false), ...location, ...own }
  }
  const busy = b.busy !== false
  const length = Math.min(1440, Math.max(1, Math.round(Number(b.duration_minutes) || (busy ? 60 : NOMINAL_EVENT_MINUTES))))
  const timeZone = itemTimeZone(opts.timeZone)
  return {
    summary,
    start: { dateTime: wallClockAt(b.date, start), timeZone },
    end: { dateTime: wallClockAt(b.date, start + length), timeZone },
    transparency: eventTransparency(b.show_as, busy),
    ...location,
    ...own,
  }
}

/** What a push sends: 'all' (the slot's day, time, length, Busy/Free and
 *  title) or 'title' (a done mark, a series renamed: ONLY the summary). */
export type EventPushFields = 'all' | 'title'

/** A start or end in a PATCH: the form not used is sent as null. */
export type EventTimePatch =
  | { date: string; dateTime: null; timeZone: null }
  | { dateTime: string; timeZone: string; date: null }

/**
 * PATCH merges objects field by field (Google: "To delete a field, specify the
 * field and set it to null"), and start and end "must both be timed or both
 * be all-day": an item turned all-day kept its old dateTime, and a timed one
 * its old date, so the change never reached Google (owner, 16.10.2026). Every
 * PATCH of a start/end sends the other form as null; an insert keeps the plain
 * body.
 */
export function timePatch(t: EventTime): EventTimePatch {
  return 'date' in t ? { date: t.date, dateTime: null, timeZone: null } : { dateTime: t.dateTime, timeZone: t.timeZone, date: null }
}

/** A body for PATCH: its start and end through timePatch. */
export function withTimePatch<B extends { start: EventTime; end: EventTime }>(body: B): Omit<B, 'start' | 'end'> & { start: EventTimePatch; end: EventTimePatch } {
  return { ...body, start: timePatch(body.start), end: timePatch(body.end) }
}

/**
 * A whole-event PATCH (186): its start and end through timePatch, and its place — none is sent as null, so a place
 * taken off in the app leaves Google too (Google: "To delete a field, specify the field and set it to null"; the app's
 * item wins, as on Apple, where the event is rewritten whole). An insert keeps the plain body. Its reminders too (193):
 * an item with no alerts of its own sends the calendar's default with no overrides (a PATCH replaces an array and
 * merges an object, so alerts taken off in the app leave Google too).
 */
export function fullEventPatch<B extends { start: EventTime; end: EventTime; location?: string; reminders?: EventReminders }>(body: B): Omit<Omit<B, 'location' | 'reminders'>, 'start' | 'end'> & { start: EventTimePatch; end: EventTimePatch; location: string | null; reminders: EventReminders } {
  const { location, reminders, ...rest } = body
  return { ...withTimePatch(rest), location: location ?? null, reminders: reminders ?? { ...DEFAULT_REMINDERS, overrides: [] } }
}

/**
 * The PATCH a push sends. A title push carries the summary and nothing else,
 * so ticking an item done never sends its old day or time back over a move
 * the owner made in Google Calendar. Anything but 'title' is the whole event,
 * its start and end through timePatch.
 */
export function eventPatchFor(body: BlockEventBody, fields: EventPushFields | string | null | undefined): { summary: string } | ReturnType<typeof fullEventPatch<BlockEventBody>> {
  return fields === 'title' ? { summary: body.summary } : fullEventPatch(body)
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
  /** Show As as the event has it (193): its transparency, all-day too — the read-back takes it only for an item whose
   *  Show As is set (else Free still means "no length", as since 155). */
  showAs: 'busy' | 'free'
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

/** A start's day: its date, or its instant's day in its own zone (else `zone`) — or in `zone` when `force`d. */
const dayOf = (t: { date?: string; dateTime?: string; timeZone?: string } | undefined, zone: string, force = false): string | null => {
  if (!t) return null
  if (t.date && ISO_DAY.test(t.date)) return t.date
  if (t.dateTime) return wallClockIn(t.dateTime, force ? zone : (t.timeZone || zone))?.date ?? null
  return null
}

/**
 * A Google event as the change the read-back applies. Times are read as the
 * wall clock of the item's own zone when the caller knows the item (183: a
 * slot's or plan's `time_zone` — the app stores its times in that zone,
 * whatever zone Google shows the event in), else of the event's own zone
 * (else the calendar's); the length from the two instants (an all-day event:
 * whole days), the title without "✓ ". A cancelled entry may carry only its
 * id (and, for one day of a series, recurringEventId + originalStartTime —
 * Google's reference). null for something with no id.
 */
export function readbackEvent(e: GoogleEventLike, calendarZone: string, itemZone?: string | null): ReadbackEvent | null {
  if (!e || typeof e.id !== 'string' || !e.id) return null
  const zone = itemZone ? itemTimeZone(itemZone) : (e.start?.timeZone || calendarZone || SERVER_EVENT_TIME_ZONE)
  const seriesId = typeof e.recurringEventId === 'string' && e.recurringEventId ? e.recurringEventId : null
  const originalDate = dayOf(e.originalStartTime, itemZone ? zone : (e.originalStartTime?.timeZone || zone), !!itemZone)
  const status = e.status === 'cancelled' ? 'cancelled' : e.status === 'tentative' ? 'tentative' : 'confirmed'
  const base = { id: e.id, seriesId, originalDate, updated: typeof e.updated === 'string' ? e.updated : null }
  if (status === 'cancelled') {
    return { ...base, status, title: null, allDay: false, date: null, time: null, minutes: null, busy: false, showAs: 'free' }
  }
  const title = typeof e.summary === 'string' ? stripDoneMark(e.summary) : null
  const busy = e.transparency !== 'transparent'
  const showAs = busy ? 'busy' as const : 'free' as const
  if (e.start?.date && ISO_DAY.test(e.start.date)) {
    const endDay = e.end?.date && ISO_DAY.test(e.end.date) ? e.end.date : addDaysToIso(e.start.date, 1)
    const days = Math.max(1, Math.round((Date.parse(`${endDay}T00:00:00Z`) - Date.parse(`${e.start.date}T00:00:00Z`)) / 86_400_000))
    return { ...base, status, title, allDay: true, date: e.start.date, time: null, minutes: Math.min(1440, days * 1440), busy: false, showAs }
  }
  const startAt = e.start?.dateTime ? wallClockIn(e.start.dateTime, zone) : null
  if (!startAt) return { ...base, status, title, allDay: false, date: null, time: null, minutes: null, busy, showAs }
  const startMs = Date.parse(e.start!.dateTime!)
  const endMs = e.end?.dateTime ? Date.parse(e.end.dateTime) : NaN
  const minutes = Number.isFinite(endMs) && endMs > startMs ? Math.min(1440, Math.round((endMs - startMs) / 60_000)) : null
  return { ...base, status, title, allDay: false, date: startAt.date, time: startAt.time, minutes, busy, showAs }
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
