// The app's events in Apple Calendar (Phase 2b, docs/features/calendar-plan.md):
// which area an item belongs to, and the iCalendar object iCloud keeps for it —
// built from the same rules as Google's events (calendarEventRules.blockEventBody
// for a slot, calendarSeries.seriesEventFor for a repeating plan), plus the
// area's emoji, alert and a link back to the app. Pure; copied into
// supabase/functions/icloud-calendar by scripts/sync-icloud-shared.mjs, which
// is where it runs (verify-icloud-events checks the copy is current).

import type { AllDayAlert, AreaKey, CalendarArea, NotesMode } from './calendarAreas'
import { blockEventBody, type BlockEventBody, type EventBlock, type EventTime } from '../calendarEventRules'
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

/** The area an item goes to: football → training → media → work (with projects) → personal. */
export function itemArea(x: AreaInput): AreaKey {
  const sources = [x.source_type, x.task_source_type].filter((s): s is string => !!s)
  if (x.category === 'football') return 'football'
  if (x.category === 'training' || sources.includes('training_session') || !!x.hevy_routine_id) return 'training'
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

/** The zone the app's times mean, as a VTIMEZONE (Europe/Oslo: CET/CEST). */
export const VTIMEZONE_OSLO = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Oslo',
  'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
  'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
  'END:VTIMEZONE',
]

const ics8 = (day: string) => day.replace(/-/g, '')
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** DTSTART / DTEND from Google's form: a date (all day) or a wall-clock time in a zone. */
function timeLine(name: 'DTSTART' | 'DTEND', t: EventTime): string {
  if ('date' in t) return `${name};VALUE=DATE:${ics8(t.date)}`
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
}

/** One VCALENDAR with one VEVENT, lines folded, CRLF throughout. */
export function eventObject(p: EventParts): string {
  const timed = !('date' in p.body.start)
  const title = areaTitle(p.body.summary, p.area)
  const notes = eventNotes(p.look.notes, p.notes, p.link)
  const zones = timed && 'timeZone' in p.body.start && p.body.start.timeZone === 'Europe/Oslo' ? VTIMEZONE_OSLO : []
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
  return { uid, ics: eventObject({ uid, body, area: o.area, look: o.look, notes, link: dayLink(o.appUrl, block.date), now: o.now }) }
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
  return { uid, plan: series, ics: eventObject({ uid, body: series.body, area: o.area, look: o.look, notes: plan.notes, link: dayLink(o.appUrl, series.first), now: o.now }) }
}

/** Where an item's event lives in its area's calendar. */
export const eventFileName = (uid: string) => `${uid.replace(/@.*$/, '').replace(/[^a-z0-9-]/gi, '-')}.ics`
