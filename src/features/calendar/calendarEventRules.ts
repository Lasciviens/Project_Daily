// ─────────────────────────────────────────────────────────────────────────────
//  One item's calendar event (migration 155) — the PURE rules of the event a
//  slot (time_blocks) becomes: timed or all-day, Busy or Free, "✓ " in front
//  once its task is done, and an item's calendar fields (193). Apple
//  Calendar's events are built from it (areas/icloudEvents.ts; generated into
//  icloud-calendar by scripts/sync-icloud-shared.mjs). Its Google Calendar
//  half (the PATCH bodies, reminders, the read-back) went with Google Calendar
//  on 25.11.2026 (docs/integrations/google-calendar.md, retired).
//
//  Import-free on purpose.
// ─────────────────────────────────────────────────────────────────────────────

/** "Do it at 14:00" has no length: the calendar gets a short Free event. Also the slot's stored length. */
export const NOMINAL_EVENT_MINUTES = 15
/** In front of a done item's event title (owner, 15.10.2026); Undo takes it off. */
export const DONE_MARK = '✓ '
/** The home zone: the zone of an item that names none (made before 183, or by a server writer). The owner's. */
export const SERVER_EVENT_TIME_ZONE = 'Europe/Oslo'
/** An IANA zone name's shape ("Europe/Oslo", "America/Argentina/Buenos_Aires", "Etc/GMT+1") — 183's CHECK. */
export const IANA_ZONE = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/

/**
 * The zone an item's times are in (183): its own when it is a zone this runtime knows, else the home zone. A
 * stored or device value is data — it lands in iCalendar TZID lines (the warning in
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

/** A title as the app keeps it: without the done mark a calendar shows. */
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
  /** false: no length — Free (155). Missing before 155 = busy. */
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
//  and the writers put them into iCalendar lines. The database CHECKs the same allow-lists
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

/** An item's place as the calendars get it (186): a name, maybe a town, maybe a map pin. */
export interface EventPlace { name: string; locality?: string; lat?: number; lon?: number }

// eslint-disable-next-line no-control-regex -- control characters are exactly what is dropped
const PLACE_CONTROL = /[\x00-\x1F\x7F-\x9F\u2028\u2029]/g
const placeLine = (t: unknown, max: number) => typeof t !== 'string' ? ''
  : Array.from(t.replace(PLACE_CONTROL, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim()
const placeCoord = (n: unknown, limit: number): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= limit

/**
 * A row's place as the writers may use it (186). The column is checked by the database, but a stored value is still
 * input (the warning in AGENTS.md — it lands in iCalendar lines): only a name of up to 120
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

/** "Jernbanetorget, Oslo": a place as one line. */
export function placeText(p: EventPlace): string {
  return p.locality ? `${p.name}, ${p.locality}` : p.name
}

export type EventTime = { date: string } | { dateTime: string; timeZone: string }

/** A slot's event: its title, start and end, Busy or Free. Apple's lines are built from it (icloudEvents.slotEvent). */
export interface BlockEventBody {
  summary: string
  start: EventTime
  end: EventTime
  transparency: 'opaque' | 'transparent'
}

/**
 * The event of a slot: a day with no time is an all-day event (end = the next
 * day — DTEND is exclusive) and Free; a time is a wall-clock dateTime in
 * `timeZone` (DST-safe), Busy when the slot has a length, Free with a nominal
 * end when it doesn't — unless Show As says (193). null when the slot has no
 * usable day.
 */
export function blockEventBody(b: EventBlock, opts: { done: boolean; timeZone: string }): BlockEventBody | null {
  if (!ISO_DAY.test(b.date ?? '')) return null
  const summary = calendarTitle(b.title, opts.done)
  const start = clockMinutes(b.start_time)
  if (start === null) {
    return { summary, start: { date: b.date }, end: { date: addDaysToIso(b.date, 1) }, transparency: eventTransparency(b.show_as, false) }
  }
  const busy = b.busy !== false
  const length = Math.min(1440, Math.max(1, Math.round(Number(b.duration_minutes) || (busy ? 60 : NOMINAL_EVENT_MINUTES))))
  const timeZone = itemTimeZone(opts.timeZone)
  return {
    summary,
    start: { dateTime: wallClockAt(b.date, start), timeZone },
    end: { dateTime: wallClockAt(b.date, start + length), timeZone },
    transparency: eventTransparency(b.show_as, busy),
  }
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
