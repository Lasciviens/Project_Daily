// ─────────────────────────────────────────────────────────────────────────────
//  A repeating plan (schedule_blocks) as ONE repeating Google Calendar event
//  (migration 147) — the pure mapping. Pure and import-free apart from the
//  repeat rule itself (daily/recurrence.ts), so scripts/verify-calendar-
//  recurrence.cjs runs it as is. The calls that send it live in
//  api/scheduleSeriesCalendar.ts.
//
//  Google's event (docs/integrations/google-calendar.md, checked 13.10.2026):
//    start / end  the FIRST occurrence: a wall-clock dateTime with no offset
//                 plus `timeZone` — required for a repeating event, it is the
//                 zone the repeat is expanded in, so every occurrence keeps
//                 its clock time across a daylight-saving change.
//    recurrence   RFC 5545 lines: RRULE, RDATE, EXDATE (DTSTART is not
//                 allowed there; start is DTSTART). The occurrences are the
//                 RRULE's and the RDATEs', plus start itself, minus EXDATEs.
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
//                      (`horizon`, kept on the row), pushed again when the
//                      app opens and less than 90 days of it remain.
//    except_dates      EXDATE (only days the rule really has — Google wants
//                      an EXDATE to name a real occurrence).
//
//  Start = the rule's FIRST day on or after effective_from, not effective_from
//  itself: RFC 5545 counts the start as an occurrence and leaves a start that
//  doesn't fit the rule undefined (a Tuesday start for a Mon/Wed plan would
//  put an extra Tuesday in Google). A first day that was taken out stays the
//  start and gets an EXDATE, so skipping a day never moves the series.
//
//  A plan that crosses midnight (end before start, or equal = 24 h) ends on
//  the next day — the same reading as dayAgendaProjection.ts.
// ─────────────────────────────────────────────────────────────────────────────

import {
  addDaysIso, dayNumber, isIsoDay, nextOccurrences, occurrencesBetween, occursOn, repeatKindOf, weeklyDaysOf,
  type RepeatRule,
} from '../daily/recurrence'

/** The RDATE list of a monthly kind covers this many days past today. */
export const SERIES_HORIZON_DAYS = 365
/** …and is pushed again once fewer than this many days of it remain. */
export const SERIES_TOPUP_DAYS = 90
/** The zone when the device names none (the owner lives in Oslo). */
export const SERIES_FALLBACK_TIME_ZONE = 'Europe/Oslo'
/** How far the first day is looked for: every 99 months, with a nearest
 *  weekday that fell before the start, is 100 months away. */
const FIRST_DAY_SEARCH_DAYS = 9 * 366

/** The columns of a schedule_blocks row the mapping reads. */
export interface SeriesTemplate extends RepeatRule {
  title:        string
  start_time:   string   // 'HH:MM' or 'HH:MM:SS'
  end_time:     string
  google_calendar_event_id?: string | null
  /** The last day the event's RDATE list covers (147); null = it lists them all. */
  google_calendar_horizon?:  string | null
  /** The zone the series was created in (147). */
  google_calendar_time_zone?: string | null
}

/** What events.insert / events.patch get. */
export interface SeriesEventBody {
  summary:    string
  start:      { dateTime: string; timeZone: string }
  end:        { dateTime: string; timeZone: string }
  recurrence: string[]
}

export interface SeriesPlan {
  body:    SeriesEventBody
  /** The first occurrence ('yyyy-MM-dd') — the event's start. */
  first:   string
  /** Store on the row: the RDATE list's last day, or null when the event
   *  carries every occurrence (an RRULE, or all picked dates). */
  horizon: string | null
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?/

export function seriesTimeZone(tz: string | null | undefined): string {
  return tz && tz.trim() ? tz : SERIES_FALLBACK_TIME_ZONE
}

/** The zone a push expands the series in. A save from the planner takes the
 *  device's (and may change it); every other push — a day carried over, the
 *  horizon top-up, Undo, a retry — keeps the series' own, so opening the app
 *  abroad never re-zones a plan. */
export function seriesPushZone(storedZone: string | null | undefined, deviceZone: string | null | undefined, fromEditor: boolean): string {
  if (!fromEditor && storedZone && storedZone.trim()) return storedZone
  return seriesTimeZone(deviceZone)
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

/** True for the kinds Google gets as an RDATE list kept up to a horizon. */
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

/** The first day the rule's pattern has on or after its start (taken-out days count). */
export function firstSeriesDay(rule: RepeatRule, today: string): string | null {
  const from = isIsoDay(rule.effective_from) ? rule.effective_from : today
  return nextOccurrences(patternOf(rule), from, 1, FIRST_DAY_SEARCH_DAYS)[0] ?? null
}

/**
 * The Google event for a repeating plan, or null when it has no occurrence
 * left to show (no day picked, every day taken out). `today` sets the
 * horizon of the monthly kinds; `timeZone` is the zone the times mean.
 */
export function seriesEventFor(t: SeriesTemplate, opts: { today: string; timeZone: string }): SeriesPlan | null {
  const startClock = clock(t.start_time)
  const endClock = clock(t.end_time)
  if (!startClock || !endClock || !isIsoDay(opts.today)) return null
  const first = firstSeriesDay(t, opts.today)
  if (!first) return null

  const tz = seriesTimeZone(opts.timeZone)
  const except = new Set((t.except_dates ?? []).filter(isIsoDay))
  const pattern = patternOf(t)
  const stamps = (days: readonly string[]) => days.map(d => icalStamp(d, startClock)).join(',')
  const recurrence: string[] = []
  let horizon: string | null = null
  let exdates: string[]

  const rrule = seriesRrule(t)
  if (rrule) {
    recurrence.push(rrule)
    // Only days the rule really has, from its first one on.
    exdates = [...except].filter(d => d >= first && occursOn(pattern, d)).sort()
  } else {
    const last = repeatKindOf(t) === 'dates'
      ? [...(t.repeat_dates ?? [])].filter(isIsoDay).sort().pop() ?? first
      : addDaysIso(first > opts.today ? first : opts.today, SERIES_HORIZON_DAYS)
    if (repeatKindOf(t) !== 'dates') horizon = last
    const days = occurrencesBetween(pattern, first, last)
    const extra = days.filter(d => d !== first && !except.has(d))
    if (!extra.length && except.has(first)) return null // nothing left to show
    if (extra.length) recurrence.push(`RDATE;TZID=${tz}:${stamps(extra)}`)
    exdates = except.has(first) ? [first] : []
  }
  if (exdates.length) recurrence.push(`EXDATE;TZID=${tz}:${stamps(exdates)}`)

  const endDay = minutesOf(endClock) <= minutesOf(startClock) ? addDaysIso(first, 1) : first
  return {
    first,
    horizon,
    body: {
      summary: t.title,
      start: { dateTime: `${first}T${startClock}`, timeZone: tz },
      end:   { dateTime: `${endDay}T${endClock}`, timeZone: tz },
      recurrence,
    },
  }
}

/** A linked monthly-kind plan whose RDATE list runs out within 90 days (or
 *  never had one) — the app pushes it again when it opens. */
export function needsHorizonTopUp(t: SeriesTemplate, today: string): boolean {
  if (!t.google_calendar_event_id || !isHorizonKind(t) || !isIsoDay(today)) return false
  const h = t.google_calendar_horizon
  return !isIsoDay(h) || dayNumber(h) - dayNumber(today) < SERIES_TOPUP_DAYS
}

// ── Retries (pushes Google didn't take) ──────────────────────────────────────
//  A day carried over (142) or an Undo whose push answered 'unknown' (no
//  connection, a network or 5xx failure) is remembered on this device and
//  pushed again the next time the app opens (useCalendarSeriesTopUp). The
//  list lives in localStorage under SERIES_PENDING_KEY and is cleared on
//  sign-out (security/accountState.ts).

export const SERIES_PENDING_KEY = 'lasci.calendarSeries.pending'

export interface PendingSeries {
  planId:   string
  /** Days of the plan (one-off blocks, 142) that get their own event once the series took their EXDATE. */
  blockIds: string[]
  /** Put back by Undo with its link reset: link it again. */
  relink?:  boolean
}

/** The stored list, or [] for anything that isn't one. */
export function parsePendingSeries(raw: string | null | undefined): PendingSeries[] {
  try {
    const list: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(list)) return []
    return list.flatMap((p): PendingSeries[] => {
      const x = p as Partial<PendingSeries> | null
      if (!x || typeof x.planId !== 'string' || !x.planId) return []
      const blockIds = Array.isArray(x.blockIds) ? x.blockIds.filter((b): b is string => typeof b === 'string' && !!b) : []
      return [{ planId: x.planId, blockIds: [...new Set(blockIds)], ...(x.relink ? { relink: true } : {}) }]
    })
  } catch {
    return []
  }
}

/** Adds a plan (and a day of it) to the list: one entry per plan, days merged. */
export function addPendingSeries(list: readonly PendingSeries[], planId: string, blockId: string | null, relink = false): PendingSeries[] {
  const at = list.findIndex(p => p.planId === planId)
  const prev: PendingSeries = at >= 0 ? list[at] : { planId, blockIds: [] }
  const next: PendingSeries = {
    planId,
    blockIds: blockId && !prev.blockIds.includes(blockId) ? [...prev.blockIds, blockId] : [...prev.blockIds],
    ...(relink || prev.relink ? { relink: true } : {}),
  }
  return at >= 0 ? list.map((p, i) => (i === at ? next : p)) : [...list, next]
}
