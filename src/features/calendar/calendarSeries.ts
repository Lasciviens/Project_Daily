// ─────────────────────────────────────────────────────────────────────────────
//  A repeating plan (schedule_blocks) as ONE repeating calendar event — the
//  pure mapping (written for Google Calendar in 147; since Google Calendar
//  went, 25.11.2026, Apple Calendar's series is built from it:
//  areas/icloudEvents.planEvent). Pure and import-free apart from the repeat
//  rule itself (daily/recurrence.ts) and the zone rule every event shares
//  (calendarEventRules.itemTimeZone, 183), so scripts/verify-calendar-
//  recurrence.cjs runs it as is.
//
//  The event (RFC 5545):
//    start / end  the FIRST occurrence: a wall-clock date-time plus its zone
//                 (TZID) — the zone the repeat is expanded in, so every
//                 occurrence keeps its clock time across a daylight-saving change.
//    recurrence   RRULE, RDATE, EXDATE lines. The occurrences are the RRULE's
//                 and the RDATEs', plus start itself, minus EXDATEs.
//
//  The kinds (recurrence.ts):
//    weekly            RRULE:FREQ=WEEKLY;WKST=MO;BYDAY=… (all seven days:
//                      FREQ=DAILY)
//    every N days      RRULE:FREQ=DAILY;INTERVAL=N
//    every N weeks     RRULE:FREQ=WEEKLY;INTERVAL=N;WKST=MO;BYDAY=… — WKST=MO
//                      because recurrence.ts counts Monday-first weeks
//    monthly, every N months, picked dates
//                      no RRULE can say "the Saturday nearest the 13th", so an
//                      RDATE list from occurrencesBetween: picked dates all of
//                      them; the monthly kinds up to a horizon a year ahead
//                      (`horizon`, kept on the row as icloud_horizon), written
//                      again when less than 90 days of it remain.
//    except_dates      EXDATE (only days the rule really has — an EXDATE must
//                      name a real occurrence).
//
//  Start = the rule's FIRST day on or after the later of effective_from and
//  the day the series starts from (`series_from`: the day the plan reached
//  Apple Calendar, icloud_from — owner, 14.10.2026: a plan added today must
//  not fill the calendar with its past weeks; the app's own projection still
//  starts at effective_from). Never the day itself: RFC 5545 counts the start
//  as an occurrence and leaves a start that doesn't fit the rule undefined. A
//  first day that was taken out stays the start and gets an EXDATE, so
//  skipping a day never moves the series.
//
//  A plan that crosses midnight (end before start, or equal = 24 h) ends on
//  the next day — the same reading as dayAgendaProjection.ts.
//
//  Since 155 (one item): a repeat with no time (start_time and end_time NULL)
//  is an ALL-DAY series — start/end are dates (the first day, the day after:
//  DTEND is exclusive) and every RDATE / EXDATE is a date
//  (`RDATE;VALUE=DATE:20261018,…`). Every series says whether it blocks time
//  (`transparency`): Busy for a time with a length, Free for a time without
//  one (busy false) and for all-day.
//
//  Since 193: End Repeat ends the RRULE — `COUNT=N` when the series starts on
//  the plan's own first day, else `UNTIL` its last day (recurrence.repeatLastDay):
//  a date for an all-day series, the last day's 23:59:59 in the plan's zone as
//  UTC for a timed one (RFC 5545: with a TZID start, UNTIL is UTC). The RDATE
//  kinds simply list no day after it (the horizon stops there). Show As sets
//  Busy / Free when the owner picked it (calendarEventRules.eventTransparency).
// ─────────────────────────────────────────────────────────────────────────────

import { eventTransparency, itemTimeZone, SERVER_EVENT_TIME_ZONE } from './calendarEventRules'
import {
  addDaysIso, isIsoDay, nextOccurrences, occurrencesBetween, occursOn, repeatCountOf, repeatKindOf, repeatLastDay,
  weeklyDaysOf, type RepeatRule,
} from '../daily/recurrence'

/** The RDATE list of a monthly kind covers this many days past today. */
export const SERIES_HORIZON_DAYS = 365
/** …and is written again once fewer than this many days of it remain. */
export const SERIES_TOPUP_DAYS = 90
/** The zone of a plan that names none — the home zone (the owner lives in Oslo). */
export const SERIES_FALLBACK_TIME_ZONE = SERVER_EVENT_TIME_ZONE
/** How far the first day is looked for: every 99 months, with a nearest
 *  weekday that fell before the start, is 100 months away. */
const FIRST_DAY_SEARCH_DAYS = 9 * 366

/** The columns of a schedule_blocks row the mapping reads. */
export interface SeriesTemplate extends RepeatRule {
  title:        string
  /** 'HH:MM' or 'HH:MM:SS'; null (with end_time) = a repeat with no time — an all-day series (155). */
  start_time:   string | null
  end_time:     string | null
  /** false: a time with no length — Free (155). Missing = busy. */
  busy?:        boolean | null
  /** The zone its Google series was made in (147, before Google Calendar went) — the plan's zone when it names none
   *  of its own (a plan saved before 183). */
  google_calendar_time_zone?: string | null
  /** The zone the plan's times are in (183): the phone's when it was made. */
  time_zone?: string | null
  /** Where the plan happens (186): the row's jsonb, read through calendarEventRules.eventPlace. */
  place?: unknown
  /** Show As (193): 'busy' | 'free'; none = by its length, as before. */
  show_as?: unknown
  /** Alert and Second Alert (193), read through calendarEventRules.eventAlerts; none = the area's own. */
  alerts?: unknown
  /** The day its series starts from (the day it reached Apple Calendar): its first real day on or after this. */
  series_from?: string | null
}

/** The series event. A timed series: wall-clock dateTime + zone; an all-day one (155): dates. */
export interface SeriesEventBody {
  summary:    string
  start:      { dateTime: string; timeZone: string } | { date: string }
  end:        { dateTime: string; timeZone: string } | { date: string }
  recurrence: string[]
  /** opaque = Busy, transparent = Free (155). */
  transparency: 'opaque' | 'transparent'
}

export interface SeriesPushOptions { today: string; timeZone: string }

export interface SeriesPlan {
  body:    SeriesEventBody
  /** The first occurrence ('yyyy-MM-dd') — the event's start. */
  first:   string
  /** Store on the row: the RDATE list's last day, or null when the event
   *  carries every occurrence (an RRULE, or all picked dates). */
  horizon: string | null
  /** Store on the row: the day the series starts from, or null when it
   *  starts at effective_from (no series_from given). */
  from:    string | null
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?/

/** The zone a series' times mean: a real zone name, else the home zone (calendarEventRules.itemTimeZone — a stored
 *  or device value is data: it lands in TZID= lines, security review 30.10.2026). */
export function seriesTimeZone(tz: string | null | undefined): string {
  return itemTimeZone(tz)
}

/** The zone a plan's series is expanded in (183): the plan's own (`time_zone` — the phone's when it was made, changed
 *  only by the owner in the sheet), else the zone its Google series was made in (before 183), else the home zone.
 *  Never the device's at write time: a write from abroad never re-zones a plan. */
export function planTimeZone(plan: Pick<SeriesTemplate, 'time_zone' | 'google_calendar_time_zone'>): string {
  const own = typeof plan.time_zone === 'string' ? plan.time_zone.trim() : ''
  return itemTimeZone(own || plan.google_calendar_time_zone)
}

/** 'HH:MM[:SS]' → 'HH:MM:SS', or null when it isn't a time. */
function clock(t: string): string | null {
  const m = TIME.exec(t ?? '')
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return `${m[1]}:${m[2]}:${m[3] ?? '00'}`
}
const minutesOf = (hhmmss: string) => Number(hhmmss.slice(0, 2)) * 60 + Number(hhmmss.slice(3, 5))

/** '2026-10-13' + '16:30:00' → '20261013T163000' (an RFC 5545 local date-time). */
export function icalStamp(day: string, hhmmss: string): string {
  return `${day.replace(/-/g, '')}T${hhmmss.replace(/:/g, '')}`
}

const everyOf = (rule: RepeatRule) => {
  const n = Math.floor(Number(rule.repeat_interval))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** True for the kinds written as an RDATE list kept up to a horizon. */
export function isHorizonKind(rule: RepeatRule): boolean {
  const kind = repeatKindOf(rule)
  return kind === 'monthly' || (kind === 'interval' && rule.repeat_unit === 'month')
}

/** The one RRULE line of the week- and day-shaped kinds; null for the others
 *  (monthly, every N months, picked dates) and for a week with no day. */
export function seriesRrule(rule: RepeatRule): string | null {
  const kind = repeatKindOf(rule)
  if (kind === 'interval' && rule.repeat_unit === 'day') {
    const n = everyOf(rule)
    return n === 1 ? 'RRULE:FREQ=DAILY' : `RRULE:FREQ=DAILY;INTERVAL=${n}`
  }
  const weekShaped = kind === 'weekly' || (kind === 'interval' && rule.repeat_unit === 'week')
  if (!weekShaped) return null
  const days = weeklyDaysOf(rule)
  if (!days.length) return null
  const n = kind === 'interval' ? everyOf(rule) : 1
  if (n === 1 && days.length === 7) return 'RRULE:FREQ=DAILY'
  const byday = MONDAY_FIRST.filter(d => days.includes(d)).map(d => BYDAY[d]).join(',')
  return `RRULE:FREQ=WEEKLY${n > 1 ? `;INTERVAL=${n}` : ''};WKST=MO;BYDAY=${byday}`
}

/** The rule's own pattern, with no day taken out. */
const patternOf = (rule: RepeatRule): RepeatRule => ({ ...rule, except_dates: [] })

/** The UTC offset of `zone` at instant `ms`, in minutes (Oslo in summer: 120). */
function seriesZoneOffset(ms: number, zone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]))
  return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60_000)
}

/** The end of `day` (23:59:59) on `zone`'s clock as an RFC 5545 UTC stamp ('20261231T225959Z'). */
export function endOfDayUtcStamp(day: string, zone: string): string {
  const wall = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 23, 59, 59)
  let at = wall - seriesZoneOffset(wall, zone) * 60_000
  at = wall - seriesZoneOffset(at, zone) * 60_000
  return new Date(at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

/**
 * End Repeat's part of the RRULE (193), '' for a repeat that never ends: `;COUNT=N` when the series starts on the
 * plan's own first day — the calendar then counts the same N times — else `;UNTIL=` its last day (a date for an
 * all-day series; the day's end in `tz` as UTC for a timed one).
 */
export function rruleEndPart(t: RepeatRule, first: string, allDay: boolean, tz: string): string {
  const count = repeatCountOf(t.repeat_count)
  if (count !== null && isIsoDay(t.effective_from)
      && nextOccurrences(patternOf(t), t.effective_from, 1, FIRST_DAY_SEARCH_DAYS)[0] === first) return `;COUNT=${count}`
  const last = repeatLastDay(t)
  if (!last) return ''
  return `;UNTIL=${allDay ? last.replace(/-/g, '') : endOfDayUtcStamp(last, tz)}`
}

/** The first day the rule's pattern has on or after its start — the later of
 *  effective_from and the day its series starts from (taken-out days count). */
export function firstSeriesDay(rule: RepeatRule & Pick<SeriesTemplate, 'series_from'>, today: string): string | null {
  const start = isIsoDay(rule.effective_from) ? rule.effective_from : today
  const added = rule.series_from
  const from = isIsoDay(added) && added > start ? added : start
  return nextOccurrences(patternOf(rule), from, 1, FIRST_DAY_SEARCH_DAYS)[0] ?? null
}

/**
 * The series event for a repeating plan, or null when it has no occurrence
 * left to show (no day picked, every day taken out). `today` sets the
 * horizon of the monthly kinds; `timeZone` is the zone the times mean.
 */
export function seriesEventFor(t: SeriesTemplate, opts: SeriesPushOptions): SeriesPlan | null {
  const allDay = t.start_time == null && t.end_time == null
  const startClock = allDay ? null : clock(t.start_time ?? '')
  const endClock = allDay ? null : clock(t.end_time ?? '')
  if ((!allDay && (!startClock || !endClock)) || !isIsoDay(opts.today)) return null
  const first = firstSeriesDay(t, opts.today)
  if (!first) return null

  const tz = seriesTimeZone(opts.timeZone)
  const except = new Set((t.except_dates ?? []).filter(isIsoDay))
  const pattern = patternOf(t)
  // All-day: dates (VALUE=DATE, no zone); timed: local date-times with TZID.
  const stamps = (days: readonly string[]) =>
    days.map(d => (startClock ? icalStamp(d, startClock) : d.replace(/-/g, ''))).join(',')
  const prefix = (name: 'RDATE' | 'EXDATE') => (allDay ? `${name};VALUE=DATE:` : `${name};TZID=${tz}:`)
  const recurrence: string[] = []
  let horizon: string | null = null
  let exdates: string[]

  const rrule = seriesRrule(t)
  if (rrule) {
    recurrence.push(`${rrule}${rruleEndPart(t, first, allDay, tz)}`)
    // Only days the rule really has, from its first one on.
    exdates = [...except].filter(d => d >= first && occursOn(pattern, d)).sort()
  } else {
    const reach = repeatKindOf(t) === 'dates'
      ? [...(t.repeat_dates ?? [])].filter(isIsoDay).sort().pop() ?? first
      : addDaysIso(first > opts.today ? first : opts.today, SERIES_HORIZON_DAYS)
    // A repeat that ends (193) lists no day after its last; its horizon is that day, so it is never topped up again.
    const end = repeatLastDay(t)
    const last = end && end < reach ? end : reach
    if (repeatKindOf(t) !== 'dates') horizon = last
    const days = occurrencesBetween(pattern, first, last)
    const extra = days.filter(d => d !== first && !except.has(d))
    if (!extra.length && except.has(first)) return null // nothing left to show
    if (extra.length) recurrence.push(`${prefix('RDATE')}${stamps(extra)}`)
    exdates = except.has(first) ? [first] : []
  }
  if (exdates.length) recurrence.push(`${prefix('EXDATE')}${stamps(exdates)}`)

  const from = isIsoDay(t.series_from) ? t.series_from : null
  if (!startClock || !endClock) {
    return {
      first, horizon, from,
      body: {
        summary: t.title,
        start: { date: first },
        end: { date: addDaysIso(first, 1) },
        recurrence,
        transparency: eventTransparency(t.show_as, false),
      },
    }
  }
  const endDay = minutesOf(endClock) <= minutesOf(startClock) ? addDaysIso(first, 1) : first
  return {
    first,
    horizon,
    from,
    body: {
      summary: t.title,
      start: { dateTime: `${first}T${startClock}`, timeZone: tz },
      end:   { dateTime: `${endDay}T${endClock}`, timeZone: tz },
      recurrence,
      transparency: eventTransparency(t.show_as, t.busy !== false),
    },
  }
}
