// The app's events in Apple Calendar (Phase 2b, docs/features/calendar-plan.md):
// which area an item belongs to, and the iCalendar object iCloud keeps for it —
// built from the same rules as Google's events (calendarEventRules.blockEventBody
// for a slot, calendarSeries.seriesEventFor for a repeating plan), plus the
// area's emoji, alert and a link back to the app. Pure; copied into
// supabase/functions/icloud-calendar by scripts/sync-icloud-shared.mjs, which
// is where it runs (verify-icloud-events checks the copy is current).

import type { AllDayAlert, AreaKey, CalendarArea, NotesMode } from './calendarAreas'
import { blockEventBody, eventPlace, IANA_ZONE, itemTimeZone, type BlockEventBody, type EventBlock, type EventPlace, type EventTime } from '../calendarEventRules'
import { seriesEventFor, type SeriesPlan, type SeriesTemplate } from '../calendarSeries'

/** What an item's area is read from: its slot's or plan's category and source, its task's. */
export interface AreaInput {
  category?:         string | null
  source_type?:      string | null
  task_source_type?: string | null
  domain?:           string | null
  project_id?:       string | null
  hevy_routine_id?:  string | null
}

const MEDIA_SOURCES = new Set(['movie', 'tv_series', 'tv_episode', 'media'])

/** The area an item goes to: football → training → games → media → work (with projects) → personal. */
export function itemArea(x: AreaInput): AreaKey {
  const sources = [x.source_type, x.task_source_type].filter((s): s is string => !!s)
  if (x.category === 'football') return 'football'
  if (x.category === 'training' || sources.includes('training_session') || !!x.hevy_routine_id) return 'training'
  if (x.category === 'games' || sources.includes('game')) return 'games'
  if (x.category === 'media' || x.domain === 'media' || sources.some(s => MEDIA_SOURCES.has(s))) return 'media'
  if (x.category === 'work' || x.category === 'projects' || x.domain === 'work' || !!x.project_id || sources.includes('project_item')) return 'work'
  return 'personal'
}

/** An item wants a calendar when its Google choice is Calendar or Both; an old row (no choice saved) where it is now. */
export function wantsCalendar(target: string | null | undefined, onACalendar: boolean): boolean {
  if (target === 'calendar' || target === 'both') return true
  if (target == null) return onACalendar
  return false
}

/** iCalendar text: backslash, semicolon, comma and every line break escaped; other control characters dropped
 *  (a lone CR, U+0085 or U+2028/2029 could end a line for some parsers — security reviews, 30.10.2026). */
export function icsEscape(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
    // eslint-disable-next-line no-control-regex -- matching control characters is the point: they are dropped
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\u2028\u2029]/g, '')
}

/** A content line folded at 75 octets (UTF-8), never inside a character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (size + n > (out.length ? 74 : 75)) { out.push(cur); cur = ''; size = 0 }
    cur += ch
    size += n
  }
  out.push(cur)
  return out.join('\r\n ')
}

/** The home zone as a VTIMEZONE (Europe/Oslo: CET/CEST) — written as is since Phase 1's live check. */
export const VTIMEZONE_OSLO = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Oslo',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
]

const ics8 = (day: string) => day.replace(/-/g, '')
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

const MINUTE = 60_000
const pad = (n: number) => String(n).padStart(2, '0')

const zoneClocks = new Map<string, Intl.DateTimeFormat>()
/** `zone`'s UTC offset at instant `t`, in minutes (Oslo in summer: 120). One formatter per zone (making one is the slow part). */
function zoneOffsetAt(t: number, zone: string): number {
  let clock = zoneClocks.get(zone)
  if (!clock) {
    clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    zoneClocks.set(zone, clock)
  }
  const p = Object.fromEntries(clock.formatToParts(new Date(t)).map(x => [x.type, x.value]))
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t) / MINUTE)
}

/** Every change of `zone`'s offset in [from, to): its instant (to the minute) and the offsets on each side. */
export function zoneTransitions(zone: string, from: number, to: number): { at: number; before: number; after: number }[] {
  const out: { at: number; before: number; after: number }[] = []
  const DAY = 1440 * MINUTE
  let prev = zoneOffsetAt(from, zone)
  for (let t = from + DAY; t <= to; t += DAY) {
    const cur = zoneOffsetAt(t, zone)
    if (cur === prev) continue
    let lo = t - DAY
    let hi = t
    while (hi - lo > MINUTE) {
      const mid = lo + Math.max(1, Math.floor((hi - lo) / MINUTE / 2)) * MINUTE
      if (zoneOffsetAt(mid, zone) === prev) lo = mid
      else hi = mid
    }
    out.push({ at: hi, before: prev, after: cur })
    prev = cur
  }
  return out
}

const icsOffset = (m: number) => `${m < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(m) / 60))}${pad(Math.abs(m) % 60)}`
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/**
 * Any real zone as a VTIMEZONE (183: an item's own zone — RFC 5545 wants one for every TZID an object names), from
 * the runtime's own zone data in the five years around `year` (two before, so even a southern summer that began the
 * year before has its onset). A zone with no change there is one STANDARD; a change that falls on the same weekday
 * of the same month at the same local time in every one of those years is a yearly rule (BYMONTH + BYDAY, as Oslo's);
 * anything else — a zone that changed its rules — lists its changes, so nothing is promised past what is known. The
 * home zone keeps VTIMEZONE_OSLO. Only a zone name the runtime knows gets here (itemTimeZone): anything else throws.
 */
const zoneDefinitions = new Map<string, string[]>()
export function vtimezoneLines(zone: string, year: number): string[] {
  if (zone === 'Europe/Oslo') return VTIMEZONE_OSLO
  if (!IANA_ZONE.test(zone) || itemTimeZone(zone) !== zone) throw new Error('Not a zone this runtime knows — not written')
  const y = Number.isInteger(year) && year > 1970 && year < 3000 ? year : new Date().getUTCFullYear()
  const key = `${zone}|${y}`
  const known = zoneDefinitions.get(key)
  if (known) return known
  const lines = zoneDefinition(zone, y)
  // Bounded (security review, 02.11.2026): a run that meets many zones and years never grows it without end.
  if (zoneDefinitions.size >= 200) zoneDefinitions.clear()
  zoneDefinitions.set(key, lines)
  return lines
}

function zoneDefinition(zone: string, y: number): string[] {
  const YEARS = 5
  const changes = zoneTransitions(zone, Date.UTC(y - 2, 0, 1), Date.UTC(y - 2 + YEARS, 0, 1))
  const wall = (t: number, offset: number) => new Date(t + offset * MINUTE)
  const stamp = (d: Date) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`
  const part = (kind: 'STANDARD' | 'DAYLIGHT', before: number, after: number, start: string, rule?: string) =>
    [`BEGIN:${kind}`, `TZOFFSETFROM:${icsOffset(before)}`, `TZOFFSETTO:${icsOffset(after)}`, `DTSTART:${start}`, ...(rule ? [rule] : []), `END:${kind}`]
  if (!changes.length) {
    const offset = zoneOffsetAt(Date.UTC(y, 0, 1), zone)
    return ['BEGIN:VTIMEZONE', `TZID:${zone}`, ...part('STANDARD', offset, offset, '19700101T000000'), 'END:VTIMEZONE']
  }
  const parts: string[] = []
  for (const kind of ['DAYLIGHT', 'STANDARD'] as const) {
    const mine = changes.filter(c => (c.after > c.before) === (kind === 'DAYLIGHT'))
    if (!mine.length) continue
    const shape = mine.map(c => {
      const d = wall(c.at, c.before)
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
      return { d, month: d.getUTCMonth() + 1, weekday: d.getUTCDay(), nth: Math.ceil(d.getUTCDate() / 7), last: d.getUTCDate() + 7 > lastDay,
        clock: `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`, before: c.before, after: c.after }
    })
    const first = shape[0]
    const same = shape.every(x => x.month === first.month && x.weekday === first.weekday && x.clock === first.clock
      && x.before === first.before && x.after === first.after)
    const nth = shape.every(x => x.nth === first.nth) ? String(first.nth) : shape.every(x => x.last) ? '-1' : null
    const everyYear = shape.length === YEARS && new Set(shape.map(x => x.d.getUTCFullYear())).size === YEARS
    if (same && nth && everyYear) {
      parts.push(...part(kind, first.before, first.after, stamp(first.d), `RRULE:FREQ=YEARLY;BYMONTH=${first.month};BYDAY=${nth}${BYDAY[first.weekday]}`))
    } else {
      for (const x of shape) parts.push(...part(kind, x.before, x.after, stamp(x.d)))
    }
  }
  return ['BEGIN:VTIMEZONE', `TZID:${zone}`, ...parts, 'END:VTIMEZONE']
}

/** DTSTART / DTEND from Google's form: a date (all day) or a wall-clock time in a zone. The last guard: a TZID is a
 *  zone name's shape or the line is not written (183 — the zone is the item's, i.e. input). */
function timeLine(name: 'DTSTART' | 'DTEND', t: EventTime): string {
  if ('date' in t) return `${name};VALUE=DATE:${ics8(t.date)}`
  if (!IANA_ZONE.test(t.timeZone) || t.timeZone.length > 64) throw new Error('An event zone is not a zone name — not written')
  return `${name};TZID=${t.timeZone}:${t.dateTime.replace(/[-:]/g, '').slice(0, 15)}`
}

/** "✓ 🏋️ Lower B": the done mark first (Google's), then the area's emoji. */
export function areaTitle(summary: string, area: CalendarArea): string {
  const done = summary.startsWith('✓ ')
  const rest = done ? summary.slice(2) : summary
  const titled = area.emoji ? `${area.emoji} ${rest}` : rest
  return done ? `✓ ${titled}` : titled
}

/** Apple's own "no alert" (2b-3): without any VALARM the iPhone may add the owner's default alert, so "None" is written
 *  as this marker — an alert of 01.04.1976 that never fires (to confirm live). */
export const NO_ALERT = ['BEGIN:VALARM', 'ACTION:NONE', 'TRIGGER;VALUE=DATE-TIME:19760401T005545Z', 'END:VALARM']

/** The event's alert. Timed: the area's, before its start ("-PT60M"; at the start "PT0S"). All day: the owner's
 *  all-day alert, at a time on its day ("PT540M" = 09:00) or the day before ("-PT900M" = 09:00 the day before).
 *  None: Apple's no-alert marker. */
export function alarmLines(minutes: number | null, timed: boolean, title: string, allDay: AllDayAlert | null): string[] {
  const at = (trigger: string) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, `TRIGGER:${trigger}`, 'END:VALARM']
  if (timed) return minutes === null ? NO_ALERT : at(minutes === 0 ? 'PT0S' : `-PT${minutes}M`)
  const m = allDay && /^([01]\d|2[0-3]):([0-5]\d)$/.exec(allDay.time)
  if (!allDay || !m) return NO_ALERT
  const ofDay = Number(m[1]) * 60 + Number(m[2])
  if (allDay.dayBefore) return at(`-PT${1440 - ofDay}M`)
  return at(ofDay === 0 ? 'PT0S' : `PT${ofDay}M`)
}

/** What an event's notes carry (the owner's choice, 2b-3): the item's own notes and/or the link back to the app. */
export function eventNotes(mode: NotesMode, notes: string | null | undefined, link: string): string {
  const own = mode === 'notes+link' || mode === 'notes' ? notes?.trim() : ''
  const back = mode === 'notes+link' || mode === 'link' ? `Open in Lasci's Board: ${link}` : ''
  return [own, back].filter(Boolean).join('\n\n')
}

/** A link to the day in the app: tappable in Apple Calendar's URL field and its notes. */
export function dayLink(appUrl: string, day: string): string {
  return `${appUrl.replace(/#.*$/, '')}#/daily?date=${day}`
}

/** The owner's settings for every event (Settings → Calendar, 2b-3). */
export interface EventLook { notes: NotesMode; allDayAlert: AllDayAlert | null }

interface EventParts {
  uid:        string
  body:       Pick<BlockEventBody, 'summary' | 'start' | 'end' | 'transparency'> & { recurrence?: string[] }
  area:       CalendarArea
  look:       EventLook
  notes:      string | null | undefined
  link:       string
  now:        Date
  /** Where it happens (186): LOCATION, and with coordinates Apple's map pin. */
  place?:     EventPlace | null
}

/** A value inside Apple's quoted parameters (X-TITLE="…"): letters, digits, spaces and plain punctuation only — a quote,
 *  iCalendar's own : and ;, a control character or anything else becomes a space (an allow-list, not escaping: the place
 *  is input). */
function pinText(t: string, max: number): string {
  return Array.from(t.replace(/[^\p{L}\p{M}\p{N} .,'&()/+#@!?\u2013\u2014-]/gu, ' ').replace(/\s+/g, ' ').trim()).slice(0, max).join('').trim()
    // A combining mark first would join the opening quote into one character (security review, 03.11.2026).
    .replace(/^\p{M}+/u, '').trim()
}
/** Every quote in the pin line stands alone: a mark or a "prepend" letter beside it would join it into one character,
 *  and a parser that reads characters, not code points, would miss the quote. */
const pinQuotes = (line: string) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(line)].filter(s => s.segment === '"').length
/** The pin line exactly as locationLines builds it — the last guard refuses anything else. */
const PIN_LINE = /^X-APPLE-STRUCTURED-LOCATION;VALUE=URI;(?:X-ADDRESS="[^"\p{Cc}]{1,80}";)?X-APPLE-RADIUS=70;X-TITLE="[^"\p{Cc}]{1,120}":geo:-?\d{1,2}\.\d{6},-?\d{1,3}\.\d{6}$/u

/**
 * An event's place (186), in the form the owner's Apple check kept (29.10.2026, which sent a full street address in
 * X-ADDRESS; here it is the town): LOCATION as two lines (the name, then the town), and with coordinates Apple's map pin (X-APPLE-STRUCTURED-LOCATION, a geo: point) plus the travel advisory
 * that lets the iPhone's Time to Leave work. No coordinates: the name alone, no pin.
 */
export function locationLines(place: EventPlace | null | undefined): string[] {
  if (!place) return []
  const lines = [`LOCATION:${icsEscape(place.locality ? `${place.name}\n${place.locality}` : place.name)}`]
  if (typeof place.lat !== 'number' || typeof place.lon !== 'number' || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)
      || Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) return lines
  const title = pinText(place.name, 120)
  const address = place.locality ? pinText(place.locality, 80) : ''
  if (!title) return lines
  const pin = `X-APPLE-STRUCTURED-LOCATION;VALUE=URI;${address ? `X-ADDRESS="${address}";` : ''}X-APPLE-RADIUS=70;`
    + `X-TITLE="${title}":geo:${place.lat.toFixed(6)},${place.lon.toFixed(6)}`
  if (!PIN_LINE.test(pin) || pinQuotes(pin) !== (address ? 4 : 2)) return lines
  return [...lines, pin, 'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC']
}

/** One VCALENDAR with one VEVENT, lines folded, CRLF throughout. */
export function eventObject(p: EventParts): string {
  const timed = !('date' in p.body.start)
  const title = areaTitle(p.body.summary, p.area)
  const notes = eventNotes(p.look.notes, p.notes, p.link)
  const zones = timed && 'timeZone' in p.body.start ? vtimezoneLines(p.body.start.timeZone, Number(p.body.start.dateTime.slice(0, 4))) : []
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Lasci's Board//Calendar//EN", 'CALSCALE:GREGORIAN', ...zones,
    'BEGIN:VEVENT',
    `UID:${p.uid}`,
    `DTSTAMP:${icsStamp(p.now)}`,
    timeLine('DTSTART', p.body.start),
    timeLine('DTEND', p.body.end),
    ...(p.body.recurrence ?? []),
    `SUMMARY:${icsEscape(title)}`,
    ...(notes ? [`DESCRIPTION:${icsEscape(notes)}`] : []),
    ...locationLines(p.place),
    `URL;VALUE=URI:${p.link}`,
    `TRANSP:${p.body.transparency === 'transparent' ? 'TRANSPARENT' : 'OPAQUE'}`,
    ...alarmLines(p.area.alertMinutes, timed, title, p.look.allDayAlert),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // The last guard: no line may carry a control character (a property smuggled in through any field).
  // eslint-disable-next-line no-control-regex -- matching control characters is the point: such a line is refused
  if (lines.some(l => /[\x00-\x08\x0A-\x1F\x7F-\x9F\u2028\u2029]/.test(l))) throw new Error('An event line holds a control character — not written')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** A slot's event (time_blocks): its id names it in iCloud, so a move or rename replaces it in place. */
export function slotEvent(
  block: EventBlock & { id: string; notes?: string | null },
  o: { done: boolean; taskNotes?: string | null; area: CalendarArea; look: EventLook; timeZone: string; appUrl: string; now: Date },
): { uid: string; ics: string } | null {
  const body = blockEventBody(block, { done: o.done, timeZone: o.timeZone })
  if (!body) return null
  const uid = `lasci-slot-${block.id}@lasciviens.github.io`
  const notes = [block.notes?.trim(), o.taskNotes?.trim()].filter(Boolean).join('\n\n') || null
  return { uid, ics: eventObject({ uid, body, area: o.area, look: o.look, notes, link: dayLink(o.appUrl, block.date), now: o.now, place: eventPlace(block.place) }) }
}

/** A repeating plan's ONE series event (schedule_blocks), from the day it reached Apple Calendar (`icloud_from`). */
export function planEvent(
  plan: SeriesTemplate & { id: string; notes?: string | null; icloud_from?: string | null },
  o: { area: CalendarArea; look: EventLook; today: string; timeZone: string; appUrl: string; now: Date },
): { uid: string; ics: string; plan: SeriesPlan } | null {
  // Google's own start day is not iCloud's: a series starts where it reached this calendar.
  const series = seriesEventFor({ ...plan, google_calendar_from: plan.icloud_from ?? o.today }, { today: o.today, timeZone: o.timeZone })
  if (!series) return null
  const uid = `lasci-plan-${plan.id}@lasciviens.github.io`
  return { uid, plan: series, ics: eventObject({ uid, body: series.body, area: o.area, look: o.look, notes: plan.notes, link: dayLink(o.appUrl, series.first), now: o.now, place: eventPlace(plan.place) }) }
}

/** A moment as Oslo's wall clock ("2026-10-28T17:30:00"), or null for no real moment. */
export function osloWallClock(iso: string | null | undefined): string | null {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return null
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(t)).map(x => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

/** A Hevy workout's event in the Training calendar (owner, 31.10.2026: "Workouts and calendar items"): its real start
 *  and end, its Hevy notes, never an alert — it is done. Named by its key (`hevy_workouts.icloud_key`, a uuid the
 *  database makes from Hevy's id), so nothing from outside is in its address. An hour when Hevy gave no real end. */
export function workoutEvent(
  w: { key: string; title: string | null; description?: string | null; start_time: string | null; end_time: string | null },
  o: { area: CalendarArea; look: EventLook; appUrl: string; now: Date },
): { uid: string; ics: string } | null {
  const start = osloWallClock(w.start_time)
  if (!start || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(w.key)) return null
  const began = Date.parse(w.start_time as string)
  const ended = w.end_time ? Date.parse(w.end_time) : NaN
  const end = osloWallClock(new Date(Number.isFinite(ended) && ended > began ? ended : began + 3_600_000).toISOString()) as string
  const uid = `lasci-workout-${w.key}@lasciviens.github.io`
  const body = {
    summary: w.title?.trim() || 'Workout',
    start: { dateTime: start, timeZone: 'Europe/Oslo' }, end: { dateTime: end, timeZone: 'Europe/Oslo' },
    transparency: 'opaque' as const,
  }
  return { uid, ics: eventObject({ uid, body, area: { ...o.area, alertMinutes: null }, look: o.look, notes: w.description, link: dayLink(o.appUrl, start.slice(0, 10)), now: o.now }) }
}

/** Where an item's event lives in its area's calendar. */
export const eventFileName = (uid: string) => `${uid.replace(/@.*$/, '').replace(/[^a-z0-9-]/gi, '-')}.ics`
