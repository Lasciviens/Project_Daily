// ─────────────────────────────────────────────────────────────────────────────
//  THE repeat rule of a recurring plan (schedule_blocks) — the one answer to
//  "does this template occur on day D?" and "which days in a range?". Every
//  projection (Daily's agenda, Home, the Training calendar, next session,
//  plan twins…) asks occursOn; nothing else reads days_of_week to decide a
//  day (.claude/rules/planning.md). Pure and import-free (sucrase verify:
//  scripts/verify-recurrence.cjs).
//
//  Day math runs on 'yyyy-MM-dd' strings turned into whole day numbers
//  (Date.UTC / 86 400 000), never on local Date objects — so a time zone or a
//  daylight-saving change can never shift a day.
//
//  The kinds (migration 146; a row without repeat_kind is 'weekly'):
//    weekly   — every week on days_of_week (covers "every day" and "weekdays")
//    monthly  — every month: the chosen weekday (days_of_week[0]) nearest the
//               start date's day of the month, or that same date (clamped to
//               the month's last day) when no weekday is chosen
//    interval — every repeat_interval days / weeks / months from the start:
//               'day' ignores weekdays, 'week' counts Monday-first weeks from
//               the start's week and uses days_of_week, 'month' uses the
//               monthly rule every N months
//    dates    — exactly the hand-picked repeat_dates
//  The start (anchor) is effective_from (081): nothing occurs before it, and
//  except_dates (142) are left out of every kind.
//
//  "Nearest" never ties: the seven days from 3 before to 3 after a date hold
//  each weekday exactly once, so the nearest one is at most 3 days away and
//  unique. It may fall in the neighbouring month (the Saturday nearest the
//  1st can be the 30th before it); it is still that month's occurrence.
//
//  Google Calendar (a later step): weekly / interval-day / interval-week map
//  to an RRULE (FREQ=WEEKLY;BYDAY=… / FREQ=DAILY;INTERVAL=N /
//  FREQ=WEEKLY;INTERVAL=N;BYDAY=…;WKST=MO) with DTSTART = effective_from;
//  monthly, interval-month and dates to an RDATE list (occurrencesBetween);
//  except_dates to EXDATEs.
// ─────────────────────────────────────────────────────────────────────────────

export type RepeatKind = 'weekly' | 'monthly' | 'interval' | 'dates'
export type RepeatUnit = 'day' | 'week' | 'month'

export const REPEAT_KINDS: readonly RepeatKind[] = ['weekly', 'monthly', 'interval', 'dates']
export const REPEAT_UNITS: readonly RepeatUnit[] = ['day', 'week', 'month']
/** The largest "every N" the planner offers (the database allows the same). */
export const MAX_REPEAT_INTERVAL = 99

/** The repeat columns of a schedule_blocks row (all but days_of_week optional:
 *  before migration 146 a row has none of them and is weekly). */
export interface RepeatRule {
  days_of_week:     readonly number[]
  repeat_kind?:     RepeatKind | null
  repeat_interval?: number | null
  repeat_unit?:     RepeatUnit | null
  repeat_dates?:    readonly string[] | null
  /** First day it may occur on, and the anchor of monthly / interval kinds. */
  effective_from?:  string | null
  /** Days it was taken out of (each became a one-off plan, 142). */
  except_dates?:    readonly string[] | null
}

const DAY_MS = 86_400_000
const pad = (n: number) => String(n).padStart(2, '0')
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDay(s: unknown): s is string {
  return typeof s === 'string' && ISO_DAY.test(s)
}

/** Whole days since 01.01.1970 for 'yyyy-MM-dd'. */
export function dayNumber(iso: string): number {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS)
}

export function isoOfDayNumber(n: number): string {
  const d = new Date(n * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDaysIso(iso: string, days: number): string {
  return isoOfDayNumber(dayNumber(iso) + days)
}

/** 0 = Sunday … 6 = Saturday (the days_of_week numbering). 01.01.1970 was a Thursday. */
export function weekdayOfIso(iso: string): number {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** The day a monthly rule lands on in `month0` of `year`: the `anchorDay` (clamped
 *  to the month's last day), or the `weekday` nearest it when one is chosen. */
export function monthlyOccurrence(anchorDay: number, year: number, month0: number, weekday: number | null): string {
  const target = Math.round(Date.UTC(year, month0, Math.min(anchorDay, daysInMonth(year, month0))) / DAY_MS)
  if (weekday == null) return isoOfDayNumber(target)
  const ahead = (weekday - weekdayOfIso(isoOfDayNumber(target)) + 7) % 7
  return isoOfDayNumber(ahead <= 3 ? target + ahead : target + ahead - 7)
}

const validDays = (days: readonly number[] | null | undefined): number[] =>
  [...new Set((days ?? []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)

/** The rule's kind; a row without one (before 146) or with an unknown one is weekly. */
export function repeatKindOf(rule: Pick<RepeatRule, 'repeat_kind'>): RepeatKind {
  return rule.repeat_kind && REPEAT_KINDS.includes(rule.repeat_kind) ? rule.repeat_kind : 'weekly'
}

function intervalOf(rule: RepeatRule): number {
  const n = Math.floor(Number(rule.repeat_interval))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** The monthly rule every `every` months from the anchor month. */
function monthlyHits(rule: RepeatRule, day: string, every: number): boolean {
  const anchor = rule.effective_from
  if (!isIsoDay(anchor)) return false // no start, no "same date as the start"
  const weekday = validDays(rule.days_of_week)[0] ?? null
  const anchorDay = Number(anchor.slice(8, 10))
  const startMonth = Number(anchor.slice(0, 4)) * 12 + Number(anchor.slice(5, 7)) - 1
  const month = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1
  // The nearest weekday may sit in the month before or after.
  for (const m of [month - 1, month, month + 1]) {
    const k = m - startMonth
    if (k < 0 || k % every !== 0) continue
    if (monthlyOccurrence(anchorDay, Math.floor(m / 12), m % 12, weekday) === day) return true
  }
  return false
}

/** The kind's own pattern, before the start and the left-out days. */
function patternHits(rule: RepeatRule, day: string): boolean {
  const days = validDays(rule.days_of_week)
  switch (repeatKindOf(rule)) {
    case 'weekly':  return days.includes(weekdayOfIso(day))
    case 'dates':   return (rule.repeat_dates ?? []).includes(day)
    case 'monthly': return monthlyHits(rule, day, 1)
    case 'interval': {
      const every = intervalOf(rule)
      const start = rule.effective_from
      if (rule.repeat_unit === 'month') return monthlyHits(rule, day, every)
      if (!isIsoDay(start)) return false
      if (rule.repeat_unit === 'day') return (dayNumber(day) - dayNumber(start)) % every === 0
      if (rule.repeat_unit === 'week') {
        const monday = (iso: string) => dayNumber(iso) - ((weekdayOfIso(iso) + 6) % 7)
        return days.includes(weekdayOfIso(day)) && ((monday(day) - monday(start)) / 7) % every === 0
      }
      return false
    }
  }
}

/** Does the template have an occurrence that STARTS on `day` ('yyyy-MM-dd')?
 *  Never before effective_from, never on an except_dates day. */
export function occursOn(rule: RepeatRule, day: string): boolean {
  if (!isIsoDay(day)) return false
  if (rule.effective_from && day < rule.effective_from) return false
  if ((rule.except_dates ?? []).includes(day)) return false
  return patternHits(rule, day)
}

/** Every day from `from` to `to` (both included) the template occurs on. */
export function occurrencesBetween(rule: RepeatRule, from: string, to: string): string[] {
  if (!isIsoDay(from) || !isIsoDay(to)) return []
  const out: string[] = []
  for (let n = dayNumber(from), end = dayNumber(to); n <= end; n++) {
    const iso = isoOfDayNumber(n)
    if (occursOn(rule, iso)) out.push(iso)
  }
  return out
}

/** The next `count` days from `from` (included) it occurs on, looking at most
 *  `horizonDays` ahead (a rule that never occurs again returns fewer). */
export function nextOccurrences(rule: RepeatRule, from: string, count: number, horizonDays = 3 * 366): string[] {
  if (!isIsoDay(from)) return []
  const out: string[] = []
  for (let n = dayNumber(from), end = n + horizonDays; n <= end && out.length < count; n++) {
    const iso = isoOfDayNumber(n)
    if (occursOn(rule, iso)) out.push(iso)
  }
  return out
}

/** The weekdays it occurs on in a typical week — only for the week-shaped
 *  kinds (weekly, every N weeks); [] for monthly / every N days or months /
 *  picked dates, which have no fixed weekday. */
export function weeklyDaysOf(rule: RepeatRule): number[] {
  const kind = repeatKindOf(rule)
  if (kind === 'weekly' || (kind === 'interval' && rule.repeat_unit === 'week')) return validDays(rule.days_of_week)
  return []
}

// ── One-line summary ─────────────────────────────────────────────────────────

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0]

/** "Tue and Thu", "Mon, Wed and Fri" — Monday first. */
function dayList(days: readonly number[]): string {
  const names = MONDAY_FIRST.filter(d => days.includes(d)).map(d => SHORT[d])
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd, 31st. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${n}${suffix}`
}

function monthlyPart(rule: RepeatRule): string {
  const anchor = rule.effective_from
  if (!isIsoDay(anchor)) return ' on the start date'
  const anchorDay = Number(anchor.slice(8, 10))
  const weekday = validDays(rule.days_of_week)[0]
  if (weekday != null) return `, the ${LONG[weekday]} nearest the ${ordinal(anchorDay)}`
  return ` on the ${ordinal(anchorDay)}${anchorDay > 28 ? ' (or the last day)' : ''}`
}

/** What the rule says, in one plain line: "Every week on Tue and Thu",
 *  "Every month, the Saturday nearest the 13th", "Every 3 days". */
export function repeatSummary(rule: RepeatRule): string {
  const days = validDays(rule.days_of_week)
  const kind = repeatKindOf(rule)
  if (kind === 'weekly') {
    if (days.length === 7) return 'Every day'
    if (days.length === 5 && [1, 2, 3, 4, 5].every(d => days.includes(d))) return 'Every weekday'
    return days.length === 0 ? 'No day picked' : `Every week on ${dayList(days)}`
  }
  if (kind === 'monthly') return `Every month${monthlyPart(rule)}`
  if (kind === 'dates') {
    const n = new Set(rule.repeat_dates ?? []).size
    return n === 0 ? 'No date picked' : `On ${n} picked ${n === 1 ? 'date' : 'dates'}`
  }
  const every = intervalOf(rule)
  if (rule.repeat_unit === 'day') return every === 1 ? 'Every day' : `Every ${every} days`
  if (rule.repeat_unit === 'month') return `${every === 1 ? 'Every month' : `Every ${every} months`}${monthlyPart(rule)}`
  const weeks = every === 1 ? 'Every week' : `Every ${every} weeks`
  return days.length === 0 ? `${weeks}, no day picked` : `${weeks} on ${dayList(days)}`
}
