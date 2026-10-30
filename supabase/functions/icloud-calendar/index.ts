import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'

// iCloud Calendar over CalDAV — Phase 1, the "Apple check" (owner, 29.10.2026:
// "I have to be sure that iCloud Calendar would work as good as Google
// Calendar"). Connect with an app-specific password, write one test event per
// feature into a "Lasci · Test" calendar, read back what iCloud kept, show
// what changed since (the iPhone → app direction), remove the test calendar.
// Everything about iCloud: docs/integrations/icloud-caldav.md.
//
// Browser caller: getUser + this function's own isAppUser. The password lives
// only in icloud_credentials (171, service role); it is sent only to iCloud's
// own hosts and never logged or returned.

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

const ALLOWED_ORIGINS = ['https://lasciviens.github.io', 'http://localhost:5173']
const APP_URL = 'https://lasciviens.github.io/Project_Daily/#/daily'
const ICLOUD_ROOT = 'https://caldav.icloud.com/'
const TEST_NAME = 'Lasci · Test'
const TEST_SLUG = 'lasci-test/'
// The read test's limits: a few requests to Apple, and an answer a phone can show.
const MAX_READ_CALENDARS = 20
const MAX_READ_PER_DAY = 40

// <icloud-pure>
// Pure: no network, no Deno — scripts/verify-icloud-caldav.cjs runs this block.

// <icloud-shared>
// GENERATED from src/ by scripts/sync-icloud-shared.mjs. Do not edit here — edit the source and re-run the script.

// ── src/features/daily/recurrence.ts ──
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
//  Google Calendar (147): a linked plan is ONE repeating event —
//  calendar/calendarSeries.ts maps weekly / interval-day / interval-week to
//  an RRULE, monthly / interval-month / dates to an RDATE list
//  (occurrencesBetween) and except_dates to EXDATEs, starting on the first
//  day this rule has on or after effective_from.
// ─────────────────────────────────────────────────────────────────────────────

type RepeatKind = 'weekly' | 'monthly' | 'interval' | 'dates'
type RepeatUnit = 'day' | 'week' | 'month'

const REPEAT_KINDS: readonly RepeatKind[] = ['weekly', 'monthly', 'interval', 'dates']
const REPEAT_UNITS: readonly RepeatUnit[] = ['day', 'week', 'month']
/** The largest "every N" the planner offers (the database allows the same). */
const MAX_REPEAT_INTERVAL = 99
/** The most picked dates one plan holds (146's CHECK allows the same). */
const MAX_REPEAT_DATES = 366

/** The repeat columns of a schedule_blocks row (all but days_of_week optional:
 *  before migration 146 a row has none of them and is weekly). */
interface RepeatRule {
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

function isIsoDay(s: unknown): s is string {
  return typeof s === 'string' && ISO_DAY.test(s)
}

/** Whole days since 01.01.1970 for 'yyyy-MM-dd'. */
function dayNumber(iso: string): number {
  return Math.round(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS)
}

function isoOfDayNumber(n: number): string {
  const d = new Date(n * DAY_MS)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

function addDaysIso(iso: string, days: number): string {
  return isoOfDayNumber(dayNumber(iso) + days)
}

/** 0 = Sunday … 6 = Saturday (the days_of_week numbering). 01.01.1970 was a Thursday. */
function weekdayOfIso(iso: string): number {
  return (((dayNumber(iso) + 4) % 7) + 7) % 7
}

function daysInMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate()
}

/** The day a monthly rule lands on in `month0` of `year`: the `anchorDay` (clamped
 *  to the month's last day), or the `weekday` nearest it when one is chosen. */
function monthlyOccurrence(anchorDay: number, year: number, month0: number, weekday: number | null): string {
  const target = Math.round(Date.UTC(year, month0, Math.min(anchorDay, daysInMonth(year, month0))) / DAY_MS)
  if (weekday == null) return isoOfDayNumber(target)
  const ahead = (weekday - weekdayOfIso(isoOfDayNumber(target)) + 7) % 7
  return isoOfDayNumber(ahead <= 3 ? target + ahead : target + ahead - 7)
}

const validDays = (days: readonly number[] | null | undefined): number[] =>
  [...new Set((days ?? []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)

/** The rule's kind; a row without one (before 146) or with an unknown one is weekly. */
function repeatKindOf(rule: Pick<RepeatRule, 'repeat_kind'>): RepeatKind {
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
function occursOn(rule: RepeatRule, day: string): boolean {
  if (!isIsoDay(day)) return false
  if (rule.effective_from && day < rule.effective_from) return false
  if ((rule.except_dates ?? []).includes(day)) return false
  return patternHits(rule, day)
}

/** Every day from `from` to `to` (both included) the template occurs on. */
function occurrencesBetween(rule: RepeatRule, from: string, to: string): string[] {
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
function nextOccurrences(rule: RepeatRule, from: string, count: number, horizonDays = 3 * 366): string[] {
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
function weeklyDaysOf(rule: RepeatRule): number[] {
  const kind = repeatKindOf(rule)
  if (kind === 'weekly' || (kind === 'interval' && rule.repeat_unit === 'week')) return validDays(rule.days_of_week)
  return []
}

/** Training days a week the plans hold on average, weekday by weekday: one a
 *  plan covers every week counts 1, one covered only every N weeks counts 1/N
 *  (the most frequent plan on a weekday wins — two plans on one Monday are
 *  still one day). Monthly, every N days / months and picked dates have no
 *  fixed weekday and add nothing. Rounded to two decimals. */
function weeklyDaysPerWeek(rules: readonly RepeatRule[]): number {
  const share = new Map<number, number>()
  for (const r of rules) {
    const each = repeatKindOf(r) === 'interval' ? 1 / intervalOf(r) : 1
    for (const d of weeklyDaysOf(r)) share.set(d, Math.max(share.get(d) ?? 0, each))
  }
  return Math.round([...share.values()].reduce((a, b) => a + b, 0) * 100) / 100
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
function ordinal(n: number): string {
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
function repeatSummary(rule: RepeatRule): string {
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

// ── src/features/calendar/calendarEventRules.ts ──
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
const NOMINAL_EVENT_MINUTES = 15
/** In front of a done item's event title (owner, 15.10.2026); Undo takes it off. */
const DONE_MARK = '✓ '
/** The zone a server-side push uses (time_blocks keeps none): the owner's. */
const SERVER_EVENT_TIME_ZONE = 'Europe/Oslo'

/** The event title: "✓ " in front once the item is done (never twice). */
function calendarTitle(title: string | null | undefined, done: boolean): string {
  const clean = stripDoneMark(title ?? '')
  return done ? `${DONE_MARK}${clean}` : clean
}

/** A title as the app keeps it: without the done mark Google shows. */
function stripDoneMark(summary: string | null | undefined): string {
  let s = (summary ?? '').trim()
  while (s.startsWith('✓')) s = s.slice(1).trim()
  return s
}

const CLOCK = /^(\d{2}):(\d{2})(?::(\d{2}))?/

/** 'yyyy-MM-dd' + n days (calendar arithmetic, no time zone involved). */
function addDaysToIso(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/** 'HH:MM[:SS]' → minutes after midnight, or null. */
function clockMinutes(t: string | null | undefined): number | null {
  const m = CLOCK.exec(t ?? '')
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null
  return Number(m[1]) * 60 + Number(m[2])
}


/** A wall-clock date-time `minutes` after `day` 00:00 (may roll into later days). */
function wallClockAt(day: string, minutes: number): string {
  const days = Math.floor(minutes / 1440)
  const rest = minutes - days * 1440
  return `${addDaysToIso(day, days)}T${pad(Math.floor(rest / 60))}:${pad(rest % 60)}:00`
}

/** The columns of a slot (time_blocks) its event is made from. */
interface EventBlock {
  date: string
  start_time: string | null
  duration_minutes: number
  title: string | null
  /** false: no length — Free on Google (155). Missing before 155 = busy. */
  busy?: boolean | null
}

type EventTime = { date: string } | { dateTime: string; timeZone: string }

/** What events.insert / events.patch get for a slot. */
interface BlockEventBody {
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
function blockEventBody(b: EventBlock, opts: { done: boolean; timeZone: string }): BlockEventBody | null {
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
type EventPushFields = 'all' | 'title'

/** A start or end in a PATCH: the form not used is sent as null. */
type EventTimePatch =
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
function timePatch(t: EventTime): EventTimePatch {
  return 'date' in t ? { date: t.date, dateTime: null, timeZone: null } : { dateTime: t.dateTime, timeZone: t.timeZone, date: null }
}

/** A body for PATCH: its start and end through timePatch. */
function withTimePatch<B extends { start: EventTime; end: EventTime }>(body: B): Omit<B, 'start' | 'end'> & { start: EventTimePatch; end: EventTimePatch } {
  return { ...body, start: timePatch(body.start), end: timePatch(body.end) }
}

/**
 * The PATCH a push sends. A title push carries the summary and nothing else,
 * so ticking an item done never sends its old day or time back over a move
 * the owner made in Google Calendar. Anything but 'title' is the whole event,
 * its start and end through timePatch.
 */
function eventPatchFor(body: BlockEventBody, fields: EventPushFields | string | null | undefined): { summary: string } | ReturnType<typeof withTimePatch<BlockEventBody>> {
  return fields === 'title' ? { summary: body.summary } : withTimePatch(body)
}

/** The done mark's PATCH: the title with or without "✓ " — and only that. */
function doneMarkPatch(title: string | null | undefined, done: boolean): { summary: string } {
  return { summary: calendarTitle(title, done) }
}

// ── The read-back (google-tasks-sync) ───────────────────────────────────────

/** The fields of a Google event the read-back reads (events.list, singleEvents=false). */
interface GoogleEventLike {
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
interface ReadbackEvent {
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
function wallClockIn(instant: string, timeZone: string): { date: string; time: string } | null {
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
function readbackEvent(e: GoogleEventLike, calendarZone: string): ReadbackEvent | null {
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
type ReadbackPlan = { mode: 'baseline' } | { mode: 'incremental'; syncToken: string }

function readbackPlan(state: { sync_token?: string | null } | null | undefined): ReadbackPlan {
  const token = state?.sync_token
  return typeof token === 'string' && token ? { mode: 'incremental', syncToken: token } : { mode: 'baseline' }
}

/** How far back the baseline reads (it only needs the token at its end). */
const READBACK_BASELINE_DAYS = 7
/** Pages a run reads at most (2500 events each). */
const READBACK_MAX_PAGES = 20

/**
 * events.list parameters. Google: "Sync tokens aren't compatible with most
 * filters" — timeMin goes on the baseline only; with a syncToken no
 * timeMin/timeMax/updatedMin/orderBy/q, and showDeleted can't be false (it is
 * left out on both, so both requests carry the same set otherwise). A page
 * repeats the same query with its pageToken.
 */
function readbackListParams(plan: ReadbackPlan, nowMs: number, pageToken?: string | null): Record<string, string> {
  const params: Record<string, string> = { maxResults: '2500' }
  if (plan.mode === 'incremental') params.syncToken = plan.syncToken
  else params.timeMin = new Date(nowMs - READBACK_BASELINE_DAYS * 86_400_000).toISOString()
  if (pageToken) params.pageToken = pageToken
  return params
}

/** 410 Gone on a sync token: Google wants a fresh full sync. */
function isSyncTokenGone(status: number | null | undefined): boolean {
  return status === 410
}
// </calendar-event-rules>

// ── src/features/calendar/calendarSeries.ts ──
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
//  Start = the rule's FIRST day on or after the later of effective_from and
//  the day the plan was added to Google (google_calendar_from, migration 148:
//  owner, 14.10.2026 — a plan added today must not fill Google with its past
//  weeks; the app's own projection still starts at effective_from). Never the
//  day itself: RFC 5545 counts the start as an occurrence and leaves a start
//  that doesn't fit the rule undefined (a Tuesday start for a Mon/Wed plan
//  would put an extra Tuesday in Google). A first day that was taken out
//  stays the start and gets an EXDATE, so skipping a day never moves the
//  series.
//
//  A plan that crosses midnight (end before start, or equal = 24 h) ends on
//  the next day — the same reading as dayAgendaProjection.ts.
//
//  Since 155 (one item): a repeat with no time (start_time and end_time NULL)
//  is an ALL-DAY series — start/end are dates (the first day, the day after:
//  Google's end is exclusive) and every RDATE / EXDATE is a date
//  (`RDATE;VALUE=DATE:20261018,…` — Google: "must be dates (not date-times)
//  for all-day events"). Every series says whether it blocks time
//  (`transparency`): Busy for a time with a length, Free for a time without
//  one (busy false) and for all-day. A day held by a moved instance of the
//  series (the read-back, 155: that slot stores `<seriesId>_…`) gets no
//  EXDATE (`keepDays`) — an EXDATE would cancel that instance on Google.
// ─────────────────────────────────────────────────────────────────────────────


/** The RDATE list of a monthly kind covers this many days past today. */
const SERIES_HORIZON_DAYS = 365
/** …and is pushed again once fewer than this many days of it remain. */
const SERIES_TOPUP_DAYS = 90
/** The zone when the device names none (the owner lives in Oslo). */
const SERIES_FALLBACK_TIME_ZONE = 'Europe/Oslo'
/** How far the first day is looked for: every 99 months, with a nearest
 *  weekday that fell before the start, is 100 months away. */
const FIRST_DAY_SEARCH_DAYS = 9 * 366

/** The columns of a schedule_blocks row the mapping reads. */
interface SeriesTemplate extends RepeatRule {
  title:        string
  /** 'HH:MM' or 'HH:MM:SS'; null (with end_time) = a repeat with no time — an all-day series (155). */
  start_time:   string | null
  end_time:     string | null
  /** false: a time with no length — Free on Google (155). Missing = busy. */
  busy?:        boolean | null
  google_calendar_event_id?: string | null
  /** The last day the event's RDATE list covers (147); null = it lists them all. */
  google_calendar_horizon?:  string | null
  /** The zone the series was created in (147). */
  google_calendar_time_zone?: string | null
  /** The day the plan was added to Google Calendar (148): its series starts
   *  on the first real day on or after this. Missing before 148. */
  google_calendar_from?: string | null
}

/** What events.insert / events.patch get. A timed series: wall-clock
 *  dateTime + zone; an all-day one (155): dates. */
interface SeriesEventBody {
  summary:    string
  start:      { dateTime: string; timeZone: string } | { date: string }
  end:        { dateTime: string; timeZone: string } | { date: string }
  recurrence: string[]
  /** opaque = Busy, transparent = Free (155). */
  transparency: 'opaque' | 'transparent'
}

/** Push options: `keepDays` — days held by a moved instance of the series (155), never EXDATEd. */
interface SeriesPushOptions { today: string; timeZone: string; keepDays?: readonly string[] }

interface SeriesPlan {
  body:    SeriesEventBody
  /** The first occurrence ('yyyy-MM-dd') — the event's start. */
  first:   string
  /** Store on the row: the RDATE list's last day, or null when the event
   *  carries every occurrence (an RRULE, or all picked dates). */
  horizon: string | null
  /** Store on the row: the day the series starts from (148), or null when
   *  it starts at effective_from (no google_calendar_from given). */
  from:    string | null
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?/

/** An IANA zone name's shape ("Europe/Oslo", "America/Argentina/Buenos_Aires", "Etc/GMT+1"). */
const IANA_ZONE = /^[A-Za-z]+(?:[/_+-][A-Za-z0-9]+)*$/

/** The zone a series' times mean: a real zone name, else the fallback. A stored or device value is data —
 *  it lands in TZID= lines, so anything that isn't a zone the runtime knows is never used (security review, 30.10.2026). */
function seriesTimeZone(tz: string | null | undefined): string {
  const z = tz?.trim()
  if (z && IANA_ZONE.test(z)) {
    try { new Intl.DateTimeFormat('en', { timeZone: z }); return z } catch { /* not a zone this runtime knows */ }
  }
  return SERIES_FALLBACK_TIME_ZONE
}

/** The zone a push expands the series in. A save from the planner takes the
 *  device's (and may change it); every other push — a day carried over, the
 *  horizon top-up, Undo, a retry — keeps the series' own, so opening the app
 *  abroad never re-zones a plan. */
function seriesPushZone(storedZone: string | null | undefined, deviceZone: string | null | undefined, fromEditor: boolean): string {
  if (!fromEditor && storedZone && storedZone.trim()) return seriesTimeZone(storedZone)
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
function icalStamp(day: string, hhmmss: string): string {
  return `${day.replace(/-/g, '')}T${hhmmss.replace(/:/g, '')}`
}

const everyOf = (rule: RepeatRule) => {
  const n = Math.floor(Number(rule.repeat_interval))
  return Number.isFinite(n) && n >= 1 ? n : 1
}

/** True for the kinds Google gets as an RDATE list kept up to a horizon. */
function isHorizonKind(rule: RepeatRule): boolean {
  const kind = repeatKindOf(rule)
  return kind === 'monthly' || (kind === 'interval' && rule.repeat_unit === 'month')
}

/** The one RRULE line of the week- and day-shaped kinds; null for the others
 *  (monthly, every N months, picked dates) and for a week with no day. */
function seriesRrule(rule: RepeatRule): string | null {
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

/** The first day the rule's pattern has on or after its start — the later of
 *  effective_from and the day it was added to Google (taken-out days count). */
function firstSeriesDay(rule: RepeatRule & Pick<SeriesTemplate, 'google_calendar_from'>, today: string): string | null {
  const start = isIsoDay(rule.effective_from) ? rule.effective_from : today
  const added = rule.google_calendar_from
  const from = isIsoDay(added) && added > start ? added : start
  return nextOccurrences(patternOf(rule), from, 1, FIRST_DAY_SEARCH_DAYS)[0] ?? null
}

/** Whether the row comes from a database with 148's column (a `*` read carries it, null or not). */
function hasSeriesFromColumn(row: object): boolean {
  return 'google_calendar_from' in row
}

/**
 * The day a push starts the series from (148): the one stored with the link;
 * else today — a new link, or a series linked before 148, which starts over
 * from the day of this push. null without 148's column: the series then
 * starts at effective_from, as before it.
 */
function seriesFromDay(row: Pick<SeriesTemplate, 'google_calendar_from'>, today: string): string | null {
  if (!hasSeriesFromColumn(row)) return null
  return isIsoDay(row.google_calendar_from) ? row.google_calendar_from : today
}

/** A series linked before 148: no start day stored yet — the app pushes it
 *  once when it opens, so Google drops the past weeks it was given. */
function needsSeriesFromDay(t: SeriesTemplate): boolean {
  return !!t.google_calendar_event_id && hasSeriesFromColumn(t) && !isIsoDay(t.google_calendar_from)
}

/** The event a push sends today: seriesEventFor from the series' start day
 *  (seriesFromDay) — what the plan's link stores as `from`. */
function seriesEventForPush(row: SeriesTemplate, opts: SeriesPushOptions): SeriesPlan | null {
  return seriesEventFor({ ...row, google_calendar_from: seriesFromDay(row, opts.today) }, opts)
}

/** A day of the plan before its series starts on Google (148: the day it was
 *  added) was never there, so a change to it (done, moved, skipped, put
 *  back) stays off Google too. */
function isBeforeSeriesStart(row: SeriesTemplate, day: string | null | undefined, today: string): boolean {
  if (!isIsoDay(day)) return false
  const first = firstSeriesDay({ ...row, google_calendar_from: seriesFromDay(row, today) }, today)
  return !!first && day < first
}

/** The repeating plans one tap adds to Google Calendar (148): not on it yet,
 *  with a day left to show from the day they would start there. */
function plansToAddToCalendar<T extends SeriesTemplate>(rows: readonly T[], today: string): T[] {
  return rows.filter(r => !r.google_calendar_event_id
    && seriesEventForPush(r, { today, timeZone: SERIES_FALLBACK_TIME_ZONE }) !== null)
}

const plans = (n: number) => `${n} repeating plan${n === 1 ? '' : 's'}`

/** "Adding 6 repeating plans to Google Calendar…" */
function addPlansProgressText(count: number): string {
  return `Adding ${plans(count)} to Google Calendar…`
}

/** The one result line of "Add plans to Calendar" ("Added 6 repeating plans
 *  to Google Calendar · 1 failed — …"); a failed one waits on the retry list. */
function addPlansResultText(r: { added: number; failed: number }): string {
  const retry = 'the app tries again the next time it opens'
  if (!r.added && !r.failed) return 'Every repeating plan is already on Google Calendar'
  if (!r.added) return `Couldn't add ${plans(r.failed)} to Google Calendar — ${retry}`
  return `Added ${plans(r.added)} to Google Calendar${r.failed ? ` · ${r.failed} failed — ${retry}` : ''}`
}

/**
 * The Google event for a repeating plan, or null when it has no occurrence
 * left to show (no day picked, every day taken out). `today` sets the
 * horizon of the monthly kinds; `timeZone` is the zone the times mean.
 */
function seriesEventFor(t: SeriesTemplate, opts: SeriesPushOptions): SeriesPlan | null {
  const allDay = t.start_time == null && t.end_time == null
  const startClock = allDay ? null : clock(t.start_time ?? '')
  const endClock = allDay ? null : clock(t.end_time ?? '')
  if ((!allDay && (!startClock || !endClock)) || !isIsoDay(opts.today)) return null
  const first = firstSeriesDay(t, opts.today)
  if (!first) return null

  const tz = seriesTimeZone(opts.timeZone)
  const keep = new Set((opts.keepDays ?? []).filter(isIsoDay))
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
    if (!extra.length && except.has(first) && !keep.has(first)) return null // nothing left to show
    if (extra.length) recurrence.push(`${prefix('RDATE')}${stamps(extra)}`)
    exdates = except.has(first) ? [first] : []
  }
  exdates = exdates.filter(d => !keep.has(d))
  if (exdates.length) recurrence.push(`${prefix('EXDATE')}${stamps(exdates)}`)

  const from = isIsoDay(t.google_calendar_from) ? t.google_calendar_from : null
  if (!startClock || !endClock) {
    return {
      first, horizon, from,
      body: {
        summary: t.title,
        start: { date: first },
        end: { date: addDaysIso(first, 1) },
        recurrence,
        transparency: 'transparent',
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
      transparency: t.busy === false ? 'transparent' : 'opaque',
    },
  }
}

/** A linked monthly-kind plan whose RDATE list runs out within 90 days (or
 *  never had one) — the app pushes it again when it opens. */
function needsHorizonTopUp(t: SeriesTemplate, today: string): boolean {
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

const SERIES_PENDING_KEY = 'lasci.calendarSeries.pending'

interface PendingSeries {
  planId:   string
  /** Days of the plan (one-off blocks, 142) that get their own event once the series took their EXDATE. */
  blockIds: string[]
  /** Put back by Undo with its link reset: link it again. */
  relink?:  boolean
}

/** The stored list, or [] for anything that isn't one. */
function parsePendingSeries(raw: string | null | undefined): PendingSeries[] {
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
function addPendingSeries(list: readonly PendingSeries[], planId: string, blockId: string | null, relink = false): PendingSeries[] {
  const at = list.findIndex(p => p.planId === planId)
  const prev: PendingSeries = at >= 0 ? list[at] : { planId, blockIds: [] }
  const next: PendingSeries = {
    planId,
    blockIds: blockId && !prev.blockIds.includes(blockId) ? [...prev.blockIds, blockId] : [...prev.blockIds],
    ...(relink || prev.relink ? { relink: true } : {}),
  }
  return at >= 0 ? list.map((p, i) => (i === at ? next : p)) : [...list, next]
}

// ── src/features/calendar/areas/icloudEvents.ts ──
// The app's events in Apple Calendar (Phase 2b, docs/features/calendar-plan.md):
// which area an item belongs to, and the iCalendar object iCloud keeps for it —
// built from the same rules as Google's events (calendarEventRules.blockEventBody
// for a slot, calendarSeries.seriesEventFor for a repeating plan), plus the
// area's emoji, alert and a link back to the app. Pure; copied into
// supabase/functions/icloud-calendar by scripts/sync-icloud-shared.mjs, which
// is where it runs (verify-icloud-events checks the copy is current).


/** What an item's area is read from: its slot's or plan's category and source, its task's. */
interface AreaInput {
  category?:         string | null
  source_type?:      string | null
  task_source_type?: string | null
  domain?:           string | null
  project_id?:       string | null
  hevy_routine_id?:  string | null
}

const MEDIA_SOURCES = new Set(['movie', 'tv_series', 'tv_episode', 'media'])

/** The area an item goes to: football → training → media → work (with projects) → personal. */
function itemArea(x: AreaInput): AreaKey {
  const sources = [x.source_type, x.task_source_type].filter((s): s is string => !!s)
  if (x.category === 'football') return 'football'
  if (x.category === 'training' || sources.includes('training_session') || !!x.hevy_routine_id) return 'training'
  if (x.category === 'media' || x.domain === 'media' || sources.some(s => MEDIA_SOURCES.has(s))) return 'media'
  if (x.category === 'work' || x.category === 'projects' || x.domain === 'work' || !!x.project_id || sources.includes('project_item')) return 'work'
  return 'personal'
}

/** An item wants a calendar when its Google choice is Calendar or Both; an old row (no choice saved) where it is now. */
function wantsCalendar(target: string | null | undefined, onACalendar: boolean): boolean {
  if (target === 'calendar' || target === 'both') return true
  if (target == null) return onACalendar
  return false
}

/** iCalendar text: backslash, semicolon, comma and every line break escaped; other control characters dropped
 *  (a lone CR could end a line for some parsers — security review, 30.10.2026). */
function icsEscape(t: string): string {
  return t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
}

/** A content line folded at 75 octets (UTF-8), never inside a character. */
function foldLine(line: string): string {
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
const VTIMEZONE_OSLO = [
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
function areaTitle(summary: string, area: CalendarArea): string {
  const done = summary.startsWith('✓ ')
  const rest = done ? summary.slice(2) : summary
  const titled = area.emoji ? `${area.emoji} ${rest}` : rest
  return done ? `✓ ${titled}` : titled
}

/** The alert before a timed event ("-PT60M"; at the start "PT0S"); an all-day event gets none. */
function alarmLines(minutes: number | null, timed: boolean, title: string): string[] {
  if (minutes === null || !timed) return []
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, `TRIGGER:${minutes === 0 ? 'PT0S' : `-PT${minutes}M`}`, 'END:VALARM']
}

/** A link to the day in the app: tappable in Apple Calendar's URL field and its notes. */
function dayLink(appUrl: string, day: string): string {
  return `${appUrl.replace(/#.*$/, '')}#/daily?date=${day}`
}

interface EventParts {
  uid:        string
  body:       Pick<BlockEventBody, 'summary' | 'start' | 'end' | 'transparency'> & { recurrence?: string[] }
  area:       CalendarArea
  notes:      string | null | undefined
  link:       string
  now:        Date
}

/** One VCALENDAR with one VEVENT, lines folded, CRLF throughout. */
function eventObject(p: EventParts): string {
  const timed = !('date' in p.body.start)
  const title = areaTitle(p.body.summary, p.area)
  const notes = [p.notes?.trim(), `Open in Lasci's Board: ${p.link}`].filter(Boolean).join('\n\n')
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
    `DESCRIPTION:${icsEscape(notes)}`,
    `URL;VALUE=URI:${p.link}`,
    `TRANSP:${p.body.transparency === 'transparent' ? 'TRANSPARENT' : 'OPAQUE'}`,
    ...alarmLines(p.area.alertMinutes, timed, title),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // The last guard: no line may carry a control character (a property smuggled in through any field).
  if (lines.some(l => /[\x00-\x08\x0A-\x1F\x7F]/.test(l))) throw new Error('An event line holds a control character — not written')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}

/** A slot's event (time_blocks): its id names it in iCloud, so a move or rename replaces it in place. */
function slotEvent(
  block: EventBlock & { id: string; notes?: string | null },
  o: { done: boolean; taskNotes?: string | null; area: CalendarArea; timeZone: string; appUrl: string; now: Date },
): { uid: string; ics: string } | null {
  const body = blockEventBody(block, { done: o.done, timeZone: o.timeZone })
  if (!body) return null
  const uid = `lasci-slot-${block.id}@lasciviens.github.io`
  const notes = [block.notes?.trim(), o.taskNotes?.trim()].filter(Boolean).join('\n\n') || null
  return { uid, ics: eventObject({ uid, body, area: o.area, notes, link: dayLink(o.appUrl, block.date), now: o.now }) }
}

/** A repeating plan's ONE series event (schedule_blocks), from the day it reached Apple Calendar (`icloud_from`). */
function planEvent(
  plan: SeriesTemplate & { id: string; notes?: string | null; icloud_from?: string | null },
  o: { area: CalendarArea; today: string; timeZone: string; appUrl: string; now: Date },
): { uid: string; ics: string; plan: SeriesPlan } | null {
  // Google's own start day is not iCloud's: a series starts where it reached this calendar.
  const series = seriesEventFor({ ...plan, google_calendar_from: plan.icloud_from ?? o.today }, { today: o.today, timeZone: o.timeZone })
  if (!series) return null
  const uid = `lasci-plan-${plan.id}@lasciviens.github.io`
  return { uid, plan: series, ics: eventObject({ uid, body: series.body, area: o.area, notes: plan.notes, link: dayLink(o.appUrl, series.first), now: o.now }) }
}

/** Where an item's event lives in its area's calendar. */
const eventFileName = (uid: string) => `${uid.replace(/@.*$/, '').replace(/[^a-z0-9-]/gi, '-')}.ics`

// </icloud-shared>

/** Credentials go only to iCloud's CalDAV hosts, over HTTPS: caldav.icloud.com and the account's pNN-caldav partition. */
export function isICloudUrl(u: string): boolean {
  try {
    const x = new URL(u)
    return x.protocol === 'https:' && !x.username && !x.password
      && (x.hostname === 'caldav.icloud.com' || /^p\d+-caldav\.icloud\.com$/.test(x.hostname))
  } catch {
    return false
  }
}

/** "Lasci · Test", "lasci test", "Lasci-Test": the owner may type the test calendar's name on the iPhone. */
export function isTestCalendarName(name: string | null | undefined): boolean {
  return (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '') === 'lascitest'
}

/** Apple's app-specific passwords are four groups of four letters (abcd-efgh-ijkl-mnop). */
export function isAppSpecificPassword(p: string): boolean {
  return /^[a-z]{4}-[a-z]{4}-[a-z]{4}-[a-z]{4}$/.test(p.trim().toLowerCase())
}

/** "o…@example.com": enough to recognise the account, not to read it. */
export function maskAppleId(email: string): string {
  const [name, domain] = email.split('@')
  return domain ? `${name.slice(0, 1)}…@${domain}` : '…'
}

/** Text going into an XML body (a sync token, an href iCloud gave). */
export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** XML text as written: a CDATA section is literal, the rest has its entities decoded (&amp; last). */
const unescapeXml = (s: string) => s.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/).map(part => (part.startsWith('<![CDATA[')
  ? part.slice(9, -3)
  : part.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#13;|&#xD;/gi, '\r').replace(/&#10;|&#xA;/gi, '\n').replace(/&amp;/g, '&'))).join('')

const P = '(?:[A-Za-z][\\w-]*:)?'
/** The inner text of the first <name> element (any namespace prefix); '' for <name/>; null when absent. */
export function xmlText(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${P}${name}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${P}${name}>)`))
  return m ? unescapeXml((m[1] ?? '').trim()) : null
}

export interface DavResponse { href: string; status: number | null; props: string }

/** A 207 multistatus: each response's href, its own status (a deleted item in a sync report) and its 200 props. */
export function parseMultistatus(xml: string): { responses: DavResponse[]; syncToken: string | null } {
  const responses: DavResponse[] = []
  const re = new RegExp(`<${P}response\\b[^>]*>([\\s\\S]*?)</${P}response>`, 'g')
  for (const m of xml.matchAll(re)) {
    const block = m[1]
    const ok: string[] = []
    for (const ps of block.matchAll(new RegExp(`<${P}propstat\\b[^>]*>([\\s\\S]*?)</${P}propstat>`, 'g'))) {
      if (/\b200\b/.test(xmlText(ps[1], 'status') ?? '')) ok.push(ps[1])
    }
    const outside = block.replace(new RegExp(`<${P}propstat\\b[^>]*>[\\s\\S]*?</${P}propstat>`, 'g'), '')
    const status = xmlText(outside, 'status')
    responses.push({ href: xmlText(block, 'href') ?? '', status: status ? Number(status.match(/\b(\d{3})\b/)?.[1] ?? NaN) || null : null, props: ok.join('\n') })
  }
  const rest = xml.replace(re, '')
  return { responses, syncToken: xmlText(rest, 'sync-token') }
}




const compact = (day: string) => day.replace(/-/g, '')
const nextDay = (day: string) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10) }
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** What the read-back looks for. */
export type Kept = 'alarm' | 'description' | 'url' | 'location' | 'pin' | 'travel' | 'tentative' | 'private' | 'free' | 'allDay' | 'rrule' | 'exdate' | 'summary'

export interface CheckEvent { key: string; label: string; uid: string; ics: string; expect: Kept[] }

/** One VEVENT in its own VCALENDAR, CRLF lines, folded. */
function calendarObject(lines: string[]): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//Lasci's Board//Apple check//EN", 'CALSCALE:GREGORIAN', ...VTIMEZONE_OSLO, ...lines, 'END:VCALENDAR']
    .map(foldLine).join('\r\n') + '\r\n'
}

/** The Apple check's events, on `day` (yyyy-MM-dd, Oslo): one per feature. */
export function checkEvents(day: string, now: Date, appUrl: string): CheckEvent[] {
  const d = compact(day)
  const at = (hhmm: string) => `${d}T${hhmm.replace(':', '')}00`
  const timed = (start: string, end: string) => [`DTSTART;TZID=Europe/Oslo:${at(start)}`, `DTEND;TZID=Europe/Oslo:${at(end)}`]
  const make = (key: string, label: string, body: string[], expect: Kept[]): CheckEvent => {
    const uid = `lasci-check-${key}@lasciviens.github.io`
    return {
      key, label, uid, expect: ['summary', ...expect],
      ics: calendarObject(['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp(now)}`, `SUMMARY:${icsEscape(`Lasci check · ${label}`)}`, ...body, 'END:VEVENT']),
    }
  }
  return [
    make('alarm', 'Alert 10 min before', [...timed('10:00', '10:30'),
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape('Lasci check · Alert')}`, 'TRIGGER:-PT10M', 'END:VALARM'], ['alarm']),
    make('notes', 'Notes and a link', [...timed('10:45', '11:15'),
      `DESCRIPTION:${icsEscape('Line one: plain text notes.\nLine two: the link below opens the app.\nLine three — æøå 🏋️')}`, `URL;VALUE=URI:${appUrl}`], ['description', 'url']),
    make('place', 'Map pin: Oslo S', [...timed('12:00', '12:30'),
      `LOCATION:${icsEscape('Oslo S\nJernbanetorget, Oslo, Norway')}`,
      'X-APPLE-STRUCTURED-LOCATION;VALUE=URI;X-ADDRESS="Jernbanetorget, Oslo, Norway";X-APPLE-RADIUS=70;X-TITLE="Oslo S":geo:59.910357,10.752245',
      'X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC'], ['location', 'pin', 'travel']),
    make('maybe', 'Maybe', [...timed('13:00', '13:30'), 'STATUS:TENTATIVE'], ['tentative']),
    make('private', 'Private', [...timed('14:00', '14:30'), 'CLASS:PRIVATE'], ['private']),
    make('free', 'Free (does not block time)', [...timed('15:00', '15:30'), 'TRANSP:TRANSPARENT'], ['free']),
    make('allday', 'All day', [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${compact(nextDay(day))}`, 'TRANSP:TRANSPARENT'], ['allDay', 'free']),
    make('repeat', 'Every day ×4, the 2nd day left out', [...timed('18:00', '18:30'),
      'RRULE:FREQ=DAILY;COUNT=4', `EXDATE;TZID=Europe/Oslo:${compact(nextDay(day))}T180000`], ['rrule', 'exdate']),
    make('emoji', 'Emoji 🏋️ and æøå in a title', [...timed('19:00', '19:15')], []),
  ]
}

/** Every VEVENT in a calendar object (a series and its moved days, or the days iCloud expanded):
 *  name → raw lines (params included); an alarm inside one counts as its VALARM. */
export function allEventProps(ics: string): Map<string, string[]>[] {
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const events: Map<string, string[]>[] = []
  let out: Map<string, string[]> | null = null
  let depth = 0
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { out = new Map(); depth = 0; continue }
    if (line === 'END:VEVENT') { if (out) events.push(out); out = null; continue }
    if (!out) continue
    if (/^BEGIN:/.test(line)) { depth++; if (line === 'BEGIN:VALARM') out.set('VALARM', [...(out.get('VALARM') ?? []), line]); continue }
    if (/^END:/.test(line)) { depth--; continue }
    if (depth > 0) continue
    const name = line.match(/^([A-Z0-9-]+)[;:]/)?.[1]
    if (name) out.set(name, [...(out.get(name) ?? []), line])
  }
  return events
}

/** The first VEVENT's properties as iCloud stored them. */
export function eventProps(ics: string): Map<string, string[]> {
  return allEventProps(ics)[0] ?? new Map()
}

/** Which of the check's features iCloud kept on an event. */
export function keptOf(props: Map<string, string[]>): Record<Kept, boolean> {
  const has = (n: string) => (props.get(n)?.length ?? 0) > 0
  const value = (n: string) => props.get(n)?.[0]?.replace(/^[^:]*:/, '') ?? ''
  return {
    summary: has('SUMMARY'),
    alarm: has('VALARM'),
    description: has('DESCRIPTION'),
    url: has('URL'),
    location: has('LOCATION'),
    pin: has('X-APPLE-STRUCTURED-LOCATION'),
    travel: has('X-APPLE-TRAVEL-ADVISORY-BEHAVIOR'),
    tentative: value('STATUS') === 'TENTATIVE',
    private: value('CLASS') === 'PRIVATE',
    free: value('TRANSP') === 'TRANSPARENT',
    allDay: /VALUE=DATE[;:]/.test(props.get('DTSTART')?.[0] ?? ''),
    rrule: has('RRULE'),
    exdate: has('EXDATE'),
  }
}

/** A text property's value, unescaped (SUMMARY;LANGUAGE=en:A\, B → "A, B"). */
const textOf = (line: string | undefined) => (line ?? '').replace(/^[^:]*:/, '').replace(/\\n/gi, ' ').replace(/\\([\\;,])/g, '$1')
const dmy = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`

/** A changed event, for "Check changes": its title and when it starts now ("29.10.2026 10:00", or the day for all-day). */
export function changeOf(props: Map<string, string[]>): { title: string; starts: string } {
  const at = startOf(props.get('DTSTART')?.[0])
  return { title: textOf(props.get('SUMMARY')?.[0]), starts: at ? `${dmy(at.day)}${at.time ? ` ${at.time}` : ''}` : '–' }
}

const OSLO = 'Europe/Oslo'
const pad2 = (n: number) => String(n).padStart(2, '0')

function wallClock(t: number, tz: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]))
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second }
}

/** The instant a wall-clock time in an IANA zone names; null for a zone this runtime doesn't know. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date | null {
  try {
    const want = Date.UTC(y, mo - 1, d, h, mi)
    const offsetAt = (t: number) => { const w = wallClock(t, tz); return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - t }
    return new Date(want - offsetAt(want - offsetAt(want)))
  } catch {
    return null
  }
}

/** An instant on the Oslo clock: its day (yyyy-MM-dd) and HH:MM. */
export function osloClock(at: Date): { day: string; time: string } {
  const w = wallClock(at.getTime(), OSLO)
  return { day: `${w.y}-${pad2(w.mo)}-${pad2(w.d)}`, time: `${pad2(w.h)}:${pad2(w.mi)}` }
}

/**
 * When an event starts, on the Oslo clock. All-day (VALUE=DATE): its date, no time. UTC (…Z) and a
 * known TZID: converted. Floating, or a zone this runtime doesn't know: as written, with the zone named.
 */
export function startOf(line: string | undefined): { day: string; time: string | null; zone: string | null } | null {
  const m = line?.match(/:(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?\s*$/)
  if (!line || !m) return null
  const day = `${m[1]}-${m[2]}-${m[3]}`
  if (!m[4]) return { day, time: null, zone: null }
  const tz = line.match(/;TZID="?([^";:]+)"?/)?.[1] ?? null
  const at = m[7] ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]))
    : tz ? zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], tz)
    : null
  return at ? { ...osloClock(at), zone: null } : { day, time: `${m[4]}:${m[5]}`, zone: tz }
}

/** The read test's days: today and the next 6 on the Oslo clock, and their edges as CalDAV UTC stamps. */
export function readWindow(now: Date): { fromDay: string; toDay: string; start: string; end: string } {
  const plus = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
  const midnight = (day: string) => zonedToUtc(+day.slice(0, 4), +day.slice(5, 7), +day.slice(8, 10), 0, 0, OSLO)!
  const fromDay = osloClock(now).day
  return { fromDay, toDay: plus(fromDay, 6), start: stamp(midnight(fromDay)), end: stamp(midnight(plus(fromDay, 7))) }
}

/** The CalDAV query for the window: events that touch it, repeating ones split into their days (expand). */
export function calendarQuery(start: string, end: string): string {
  return '<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
    + `<d:prop><d:getetag/><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop>`
    + `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter>`
    + '</c:calendar-query>'
}

export interface ICloudCalendar { href: string; name: string; color: string | null }

/** The component names a calendar takes (VEVENT, VTODO), whichever quotes the XML uses. */
const compsOf = (set: string | null) => [...(set ?? '').matchAll(/name\s*=\s*["']?([A-Za-z]+)/g)].map(m => m[1].toUpperCase())

/** The event calendars in the calendar home (not the inbox, outbox, notifications or a tasks-only list). */
export function calendarsOf(responses: DavResponse[]): ICloudCalendar[] {
  return responses
    .filter(r => /<(?:[\w-]+:)?calendar[\s/>]/.test(xmlText(r.props, 'resourcetype') ?? ''))
    .filter(r => { const comps = compsOf(xmlText(r.props, 'supported-calendar-component-set')); return !comps.length || comps.includes('VEVENT') })
    .map(r => {
      const color = xmlText(r.props, 'calendar-color') ?? ''
      return { href: r.href, name: xmlText(r.props, 'displayname') || 'Untitled', color: /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color) ? color.slice(0, 7) : null }
    })
}

/**
 * What the calendar home listed, by kind only ("collection calendar [VEVENT] ×5") — element names,
 * never a calendar's name or address — so a read that found no calendar can say why.
 */
export function listingKinds(responses: DavResponse[]): string[] {
  const counts = new Map<string, number>()
  for (const r of responses) {
    const types = [...(xmlText(r.props, 'resourcetype') ?? '').matchAll(/<(?:[\w-]+:)?([\w-]+)/g)].map(m => m[1])
    const comps = compsOf(xmlText(r.props, 'supported-calendar-component-set'))
    const kind = `${types.join(' ') || 'no type'}${comps.length ? ` [${comps.join(' ')}]` : ''}`
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, n]) => (n > 1 ? `${kind} ×${n}` : kind))
}

export interface ReadEvent {
  /** yyyy-MM-dd on the Oslo clock */
  day:        string
  /** HH:MM on the Oslo clock; null = all day */
  time:       string | null
  title:      string
  /** A repeating event: a series (RRULE) or one of its days (RECURRENCE-ID). */
  repeats:    boolean
  /** The whole series in one piece (iCloud didn't split it into days); its day is where it began. */
  series:     boolean
  /** Someone else's event you were invited to, or one you invited people to. */
  invitation: boolean
  /** A zone this runtime doesn't know: the time is as written there. */
  zone:       string | null
}

/** One calendar object as rows (cancelled ones left out, as Apple Calendar leaves them out). */
export function readEventsOf(ics: string): ReadEvent[] {
  return allEventProps(ics).flatMap(p => {
    const at = startOf(p.get('DTSTART')?.[0])
    if (!at || textOf(p.get('STATUS')?.[0]) === 'CANCELLED') return []
    const series = (p.get('RRULE')?.length ?? 0) > 0
    return [{
      day: at.day, time: at.time, zone: at.zone, title: textOf(p.get('SUMMARY')?.[0]) || '(no title)',
      repeats: series || (p.get('RECURRENCE-ID')?.length ?? 0) > 0, series,
      invitation: (p.get('ORGANIZER')?.length ?? 0) > 0 || (p.get('ATTENDEE')?.length ?? 0) > 0,
    }]
  })
}

export interface ReadRow extends Omit<ReadEvent, 'day' | 'series'> { calendar: string; color: string | null; since: string | null }

/**
 * The window's events by day, all-day first, then by time. One that began before the window
 * (a trip, a multi-day event) shows on its first day with "since". A series iCloud didn't split
 * goes in `series`: its days aren't known without working out the repeat rule.
 */
export function byDay(calendars: { name: string; color: string | null; events: ReadEvent[] }[], fromDay: string, toDay: string):
  { days: { day: string; events: ReadRow[] }[]; series: ReadRow[] } {
  const days = new Map<string, ReadRow[]>()
  const series: ReadRow[] = []
  for (const cal of calendars) {
    for (const e of cal.events) {
      const row: ReadRow = { calendar: cal.name, color: cal.color, time: e.time, title: e.title, repeats: e.repeats, invitation: e.invitation, zone: e.zone, since: null }
      if (e.series && (e.day < fromDay || e.day > toDay)) { series.push({ ...row, since: e.day }); continue }
      if (e.day > toDay) continue
      const day = e.day < fromDay ? fromDay : e.day
      days.set(day, [...(days.get(day) ?? []), e.day < fromDay ? { ...row, since: e.day } : row])
    }
  }
  const order = (a: ReadRow, b: ReadRow) => (a.time ?? '') < (b.time ?? '') ? -1 : (a.time ?? '') > (b.time ?? '') ? 1 : a.title.localeCompare(b.title)
  return {
    days: [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, events]) => ({ day, events: events.sort(order) })),
    series: series.sort((a, b) => a.title.localeCompare(b.title)),
  }
}
// The app's calendars per area — hand-mirrored from src/features/calendar/areas/calendarAreas.ts
// (verify-calendar-areas compares the two blocks).
// <calendar-areas>
export const AREA_KEYS = ['training', 'work', 'personal', 'media', 'football'] as const
export type AreaKey = typeof AREA_KEYS[number]

export interface CalendarArea {
  /** The calendar's name in Apple Calendar. */
  name:         string
  /** In front of each event's title ("🏋️ Lower B"); '' for none. */
  emoji:        string
  /** The calendar's colour, #RRGGBB. */
  color:        string
  /** The alert every event of the area gets, in minutes before it; null for none. */
  alertMinutes: number | null
  /** Off: the area gets no calendar of its own (one made earlier stays in iCloud). */
  enabled:      boolean
  /** Where the area's events go: Google Calendar (as before) or its Apple Calendar (Phase 2b). */
  app:          'google' | 'apple'
}

export interface CalendarPrefs { areas: Record<AreaKey, CalendarArea> }

/** Quick picks for the default alert (minutes before; null = none); any whole number of minutes up to ALERT_MAX is a choice too. */
export const ALERT_CHOICES: readonly (number | null)[] = [null, 0, 5, 10, 15, 30, 60, 120, 1440]
/** Four weeks: the longest alert the app sets. */
export const ALERT_MAX = 40320

/** A real alert choice: none, or whole minutes from 0 (at the start) to four weeks. */
export const isAlertMinutes = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= ALERT_MAX)

export const DEFAULT_AREAS: Record<AreaKey, CalendarArea> = {
  training: { name: 'Lasci · Training', emoji: '🏋️', color: '#FF9500', alertMinutes: 60, enabled: true, app: 'google' },
  work:     { name: 'Lasci · Work', emoji: '💼', color: '#007AFF', alertMinutes: 10, enabled: true, app: 'google' },
  personal: { name: 'Lasci · Personal', emoji: '🏠', color: '#34C759', alertMinutes: null, enabled: true, app: 'google' },
  media:    { name: 'Lasci · Media', emoji: '📺', color: '#AF52DE', alertMinutes: null, enabled: true, app: 'google' },
  football: { name: 'Lasci · Football', emoji: '⚽', color: '#FF3B30', alertMinutes: 15, enabled: true, app: 'google' },
}

const NAME_MAX = 60
/** Code points: a flag is 2, a family emoji up to about 10. */
const EMOJI_MAX = 12

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The saved settings, checked where they enter: a missing or wrong value falls back to its default. */
export function readCalendarPrefs(raw: unknown): CalendarPrefs {
  const saved = isRecord(raw) && isRecord(raw.areas) ? raw.areas : {}
  const areas = {} as Record<AreaKey, CalendarArea>
  for (const key of AREA_KEYS) {
    const d = DEFAULT_AREAS[key]
    const a = isRecord(saved[key]) ? saved[key] : {}
    const name = typeof a.name === 'string' ? a.name.trim() : ''
    const emoji = typeof a.emoji === 'string' ? a.emoji.trim() : null
    const color = typeof a.color === 'string' && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color.toUpperCase() : d.color
    const alert = 'alertMinutes' in a ? a.alertMinutes : undefined
    areas[key] = {
      name: name && name.length <= NAME_MAX ? name : d.name,
      emoji: emoji !== null && [...emoji].length <= EMOJI_MAX ? emoji : d.emoji,
      color,
      alertMinutes: alert !== undefined && isAlertMinutes(alert) ? alert : d.alertMinutes,
      enabled: typeof a.enabled === 'boolean' ? a.enabled : d.enabled,
      app: a.app === 'apple' || a.app === 'google' ? a.app : d.app,
    }
  }
  return { areas }
}

/** Where an area's calendar lives under the calendar home: fixed per area, so a rename never makes a second calendar. */
export const areaSlug = (key: AreaKey) => `lasci-${key}/`

/** Apple's calendar colour form, #RRGGBBAA. */
export const appleColor = (hex: string) => `${hex.toUpperCase()}FF`
// </calendar-areas>

/** A PROPPATCH (and MKCALENDAR) property set: the calendar's name and Apple colour. */
export function calendarProps(name: string, color: string): string {
  return `<d:displayname>${escapeXml(name)}</d:displayname><a:calendar-color>${appleColor(color)}</a:calendar-color>`
}

// The stored app-specific password, sealed with AES-GCM (Phase 2a): `enc:v1:<iv>:<ciphertext>`, both base64,
// the account's id as additional data so a sealed value can't be moved to another row. A row from before
// sealing is plain text and is sealed the next time the function reads it with a key.
const SEAL = 'enc:v1:'
export const isSealed = (stored: string) => stored.startsWith(SEAL)
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0))

/** The key from its secret (32 bytes, base64); null when it is missing or not 32 bytes. */
export async function sealKey(secret: string | null | undefined): Promise<CryptoKey | null> {
  if (!secret) return null
  const raw = (() => { try { return unb64(secret.trim()) } catch { return null } })()
  if (!raw || raw.length !== 32) return null
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealSecret(plain: string, key: CryptoKey, userId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) }, key, new TextEncoder().encode(plain))
  return `${SEAL}${b64(iv)}:${b64(new Uint8Array(ct))}`
}

/** The password as stored: sealed → opened with the key (null when it can't be), plain → as it is. */
export async function openSecret(stored: string, key: CryptoKey | null, userId: string): Promise<string | null> {
  if (!isSealed(stored)) return stored
  if (!key) return null
  const [iv, ct] = stored.slice(SEAL.length).split(':')
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(userId) }, key, unb64(ct))
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
/**
 * Where an item's event lives: its file (named by the item's own id) in an area calendar the app made. Derived
 * every time from the service-role record of the area calendars — never from anything the browser or the assistant
 * can write — so a put or a delete can only ever reach the app's own event (security review, 30.10.2026).
 */
export function ownEventUrl(entity: 'slot' | 'plan', id: string, area: string | null, areaCals: Record<string, { url?: string }>): string | null {
  const cal = area && (AREA_KEYS as readonly string[]).includes(area) ? areaCals[area]?.url : undefined
  if (!cal || !isICloudUrl(cal) || !/^[0-9a-f-]{36}$/i.test(id)) return null
  return new URL(eventFileName(`lasci-${entity}-${id}@lasciviens.github.io`), cal).toString()
}

// </icloud-pure>

class ICloudError extends Error {
  constructor(public code: string, message: string) { super(message) }
}

interface Creds { email: string; password: string }

function basic(c: Creds): string {
  const bytes = new TextEncoder().encode(`${c.email}:${c.password}`)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return `Basic ${btoa(bin)}`
}

/** One CalDAV request to iCloud. Redirects are followed by hand, iCloud hosts only (fetch drops the
 *  Authorization header across hosts, and an unchecked Location could carry it elsewhere). */
async function dav(c: Creds, method: string, url: string, body?: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; url: string; etag: string | null }> {
  let current = url
  for (let hop = 0; hop < 4; hop++) {
    if (!isICloudUrl(current)) throw new ICloudError('not_icloud', 'iCloud pointed to a place outside icloud.com — stopped')
    let res: Response
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        headers: {
          Authorization: basic(c),
          ...(body ? { 'Content-Type': method === 'PUT' ? 'text/calendar; charset=utf-8' : 'application/xml; charset=utf-8' } : {}),
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(15_000),
      })
    } catch {
      throw new ICloudError('unreachable', 'iCloud could not be reached')
    }
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location')
      await res.body?.cancel()
      if (!loc) throw new ICloudError('redirect', `iCloud answered ${res.status} with nowhere to go`)
      current = new URL(loc, current).toString()
      // A 303 means "read it with GET" — never re-send a write there.
      if (res.status === 303) { method = 'GET'; body = undefined }
      continue
    }
    if (res.status === 401) { await res.body?.cancel(); throw new ICloudError('auth', 'Apple did not accept the Apple ID or app-specific password') }
    return { status: res.status, text: await res.text(), url: current, etag: res.headers.get('etag') }
  }
  throw new ICloudError('redirect', 'iCloud redirected too many times')
}

const XML = '<?xml version="1.0" encoding="utf-8"?>'
const NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"'

async function propfind(c: Creds, url: string, props: string, depth: '0' | '1') {
  const r = await dav(c, 'PROPFIND', url, `${XML}<d:propfind ${NS}><d:prop>${props}</d:prop></d:propfind>`, { Depth: depth })
  if (r.status !== 207) throw new ICloudError('propfind', `iCloud answered ${r.status} when asked for the calendars`)
  return { ...parseMultistatus(r.text), url: r.url }
}

/** Connect: the principal, then its calendar home (on the account's own pNN-caldav host). */
async function discover(c: Creds): Promise<{ principal: string; home: string }> {
  const a = await propfind(c, ICLOUD_ROOT, '<d:current-user-principal/>', '0')
  const href = xmlText(a.responses[0]?.props ?? '', 'href')
  if (!href) throw new ICloudError('discovery', 'iCloud did not say where the calendars are')
  const principal = new URL(href, a.url).toString()
  const b = await propfind(c, principal, '<c:calendar-home-set/>', '0')
  const homeHref = xmlText(b.responses[0]?.props ?? '', 'href')
  if (!homeHref) throw new ICloudError('discovery', 'iCloud did not give a calendar home')
  const home = new URL(homeHref, b.url).toString()
  if (!isICloudUrl(principal) || !isICloudUrl(home)) throw new ICloudError('not_icloud', 'iCloud pointed outside icloud.com — stopped')
  return { principal, home: home.endsWith('/') ? home : `${home}/` }
}

interface Step { step: string; ok: boolean; detail: string }

/** The test calendar: made by the app (MKCALENDAR), else one called "Lasci · Test" the owner made. */
async function ensureTestCalendar(c: Creds, home: string, stored: string | null, steps: Step[]): Promise<{ url: string; name: string } | null> {
  if (stored) {
    const r = await dav(c, 'PROPFIND', stored, `${XML}<d:propfind ${NS}><d:prop><d:displayname/></d:prop></d:propfind>`, { Depth: '0' })
    if (r.status === 207) {
      steps.push({ step: 'Test calendar', ok: true, detail: 'found from the last check' })
      return { url: stored, name: xmlText(parseMultistatus(r.text).responses[0]?.props ?? '', 'displayname') ?? TEST_NAME }
    }
  }
  const url = new URL(TEST_SLUG, home).toString()
  const mk = await dav(c, 'MKCALENDAR', url,
    `${XML}<c:mkcalendar ${NS}><d:set><d:prop><d:displayname>${TEST_NAME}</d:displayname><a:calendar-color>#7C3AEDFF</a:calendar-color>`
    + '<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>')
  if (mk.status === 201) {
    steps.push({ step: 'Make a calendar', ok: true, detail: `"${TEST_NAME}" made by the app, in purple` })
    return { url, name: TEST_NAME }
  }
  // 405 may mean "already there" — only when it really is our test calendar.
  if (mk.status === 405) {
    const there = await dav(c, 'PROPFIND', url, `${XML}<d:propfind ${NS}><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`, { Depth: '0' })
    const props = there.status === 207 ? parseMultistatus(there.text).responses[0]?.props ?? '' : ''
    if (isTestCalendarName(xmlText(props, 'displayname')) && /calendar/.test(xmlText(props, 'resourcetype') ?? '')) {
      steps.push({ step: 'Make a calendar', ok: true, detail: `"${TEST_NAME}" was already there` })
      return { url, name: TEST_NAME }
    }
  }
  steps.push({ step: 'Make a calendar', ok: false, detail: `iCloud answered ${mk.status} — looking for one called "Lasci Test" instead` })
  const list = await propfind(c, home, '<d:displayname/><d:resourcetype/>', '1')
  const found = list.responses.find(r => isTestCalendarName(xmlText(r.props, 'displayname')) && /calendar/.test(xmlText(r.props, 'resourcetype') ?? ''))
  if (!found) return null
  steps.push({ step: 'Test calendar', ok: true, detail: `found "${xmlText(found.props, 'displayname')}"` })
  return { url: new URL(found.href, list.url).toString(), name: xmlText(found.props, 'displayname') ?? TEST_NAME }
}

/** What iCloud has for these hrefs (calendar-multiget): href → the stored iCalendar. */
async function multiget(c: Creds, calendar: string, hrefs: string[]): Promise<Map<string, string>> {
  if (!hrefs.length) return new Map()
  const r = await dav(c, 'REPORT', calendar,
    `${XML}<c:calendar-multiget ${NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs.map(h => `<d:href>${escapeXml(h)}</d:href>`).join('')}</c:calendar-multiget>`,
    { Depth: '1' })
  if (r.status !== 207) throw new ICloudError('read', `iCloud answered ${r.status} when the events were read back`)
  const out = new Map<string, string>()
  for (const resp of parseMultistatus(r.text).responses) {
    const data = xmlText(resp.props, 'calendar-data')
    if (data) out.set(new URL(resp.href, r.url).pathname, data)
  }
  return out
}

async function syncToken(c: Creds, calendar: string): Promise<string | null> {
  try {
    const r = await propfind(c, calendar, '<d:sync-token/>', '0')
    return xmlText(r.responses[0]?.props ?? '', 'sync-token')
  } catch (e) {
    if (e instanceof ICloudError && e.code === 'auth') throw e
    return null
  }
}

/** Why there is no key: not set at all, or set to something that isn't 32 bytes in base64 (both read as no key). */
function keyProblem(): string {
  return Deno.env.get('ICLOUD_ENC_KEY')?.trim()
    ? 'ICLOUD_ENC_KEY is set, but it isn\'t a key the app can use — make one with "openssl rand -base64 32" and paste the whole line it prints (44 characters, ending in =) as the secret\'s value'
    : 'The key that seals the stored password (ICLOUD_ENC_KEY) is not set yet — see the deploy checklist'
}

/** One area's calendar: the stored one gets its name and colour, else it is made at its fixed place (or found there). */
async function placeAreaCalendar(c: Creds, home: string, stored: string | null, key: AreaKey, area: CalendarArea): Promise<{ url: string; state: 'created' | 'updated' | 'found' }> {
  const props = calendarProps(area.name, area.color)
  const patch = async (url: string) => {
    const r = await dav(c, 'PROPPATCH', url, `${XML}<d:propertyupdate ${NS}><d:set><d:prop>${props}</d:prop></d:set></d:propertyupdate>`)
    if (r.status === 404) return 'gone' as const
    // 207 with each property's own status: the name must be among the accepted ones.
    if (r.status === 207 && /displayname/.test(parseMultistatus(r.text).responses[0]?.props ?? '')) return 'ok' as const
    throw new ICloudError('patch', `iCloud answered ${r.status} when "${area.name}" was updated`)
  }
  // Deleted on the iPhone: made again at its place below.
  if (stored && isICloudUrl(stored) && await patch(stored) === 'ok') return { url: stored, state: 'updated' }
  const url = new URL(areaSlug(key), home).toString()
  const mk = await dav(c, 'MKCALENDAR', url,
    `${XML}<c:mkcalendar ${NS}><d:set><d:prop>${props}<c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`)
  if (mk.status === 201) return { url, state: 'created' }
  // Refused (405 is the standard answer for "already there"; iCloud's own answer is not confirmed): something may be
  // at the area's place already — taken only when it is a calendar (made by this app before, e.g. before a re-connect).
  const there = await dav(c, 'PROPFIND', url, `${XML}<d:propfind ${NS}><d:prop><d:resourcetype/></d:prop></d:propfind>`, { Depth: '0' })
  const type = there.status === 207 ? xmlText(parseMultistatus(there.text).responses[0]?.props ?? '', 'resourcetype') ?? '' : ''
  if (/<(?:[\w-]+:)?calendar[\s/>]/.test(type) && await patch(url) === 'ok') return { url, state: 'found' }
  throw new ICloudError('mkcalendar', `iCloud answered ${mk.status} when "${area.name}" was made`)
}

// ── Phase 2b: the app's events in Apple Calendar (the queue, icloud_outbox, 173) ──
const DRAIN_MAX_ROWS = 25
const DRAIN_MAX_MS = 20_000
/** A drain's lease: longer than a run, short enough that a crashed one never blocks for long. */
const DRAIN_LEASE_MS = 60_000

interface QueueRow { id: number; entity: 'slot' | 'plan'; entity_id: string; area: AreaKey | null; requested_at: string; attempts: number }
type Db = SupabaseClient

/** A failed row waits 1 min, then twice as long each time, at most a day. */
const retryAt = (attempts: number) => new Date(Date.now() + Math.min(86_400_000, 60_000 * 2 ** Math.min(attempts, 11))).toISOString()

/**
 * Puts one event at its own address; iCloud's new version (etag) when it gives one. With the version the app
 * last wrote, If-Match: a change made on the iPhone since (412) is never written over — it waits for step 2c.
 */
async function putEvent(c: Creds, url: string, ics: string, etag: string | null): Promise<string | null> {
  const r = await dav(c, 'PUT', url, ics, etag ? { 'If-Match': etag } : {})
  if (r.status === 412) throw new ICloudError('changed', 'Changed in Apple Calendar since the app wrote it — kept as it is there until changes from the iPhone come back (step 2c)')
  if (r.status !== 201 && r.status !== 204) throw new ICloudError('put', `iCloud answered ${r.status} when an event was written`)
  return r.etag
}

/** The calendar an area's event must go to is missing (never made, or the account was connected again). */
const NO_AREA_CALENDAR = 'Make the area calendars first: Settings → Calendar → Create in Apple Calendar'

/** Removes the item's own event in an area calendar; gone already is fine. */
async function removeOwnEvent(c: Creds, entity: 'slot' | 'plan', id: string, area: string | null, areaCals: Record<string, { url?: string }>): Promise<void> {
  if (!area) return
  // A link is never cleared without a real DELETE: no calendar to delete from means the row waits.
  const url = ownEventUrl(entity, id, area, areaCals)
  if (!url) throw new ICloudError('calendars', NO_AREA_CALENDAR)
  const r = await dav(c, 'DELETE', url)
  if (r.status >= 300 && r.status !== 404 && r.status !== 410) throw new ICloudError('delete', `iCloud answered ${r.status} when an event was removed`)
}

/**
 * One queued slot or plan, read live: when it wants a calendar and its area is on Apple, its event is put
 * (the new copy first, then the old one in another area's calendar goes); otherwise its event is removed.
 * Returns what happened, for the count.
 */
async function drainOne(db: Db, c: Creds, userId: string, q: QueueRow, prefs: CalendarPrefs, areaCals: Record<string, { url?: string }>, today: string): Promise<'put' | 'removed' | 'none'> {
  // Old copies to take away after the new one is in: the row's own, and the queue's (an Undo can bring a row back unlinked).
  const removeOld = async (entity: 'slot' | 'plan', id: string, keep: string | null, ...olds: (string | null)[]) => {
    for (const old of new Set(olds.filter((a): a is string => !!a && a !== keep))) await removeOwnEvent(c, entity, id, old, areaCals)
  }
  /** The link is written only while it still is what was read (another drain or a delete since: nothing is overwritten). */
  const link = async (table: 'time_blocks' | 'schedule_blocks', id: string, was: string | null, values: Record<string, unknown>) => {
    let u = db.from(table).update(values).eq('id', id).eq('user_id', userId)
    u = was === null ? u.is('icloud_area', null) : u.eq('icloud_area', was)
    const { data, error } = await u.select('id')
    if (error) throw new ICloudError('store', 'An event was written, but the app could not save where')
    return (data ?? []).length > 0
  }
  /** The area a row is linked to now (null when the row is gone). */
  const linkedArea = async (table: 'time_blocks' | 'schedule_blocks', id: string): Promise<string | null> => {
    const { data } = await db.from(table).select('icloud_area').eq('id', id).eq('user_id', userId).maybeSingle()
    return data?.icloud_area ?? null
  }

  if (q.entity === 'slot') {
    const { data: b, error } = await db.from('time_blocks')
      .select('id, date, start_time, duration_minutes, title, busy, notes, category, source_type, task_id, google_calendar_event_id, icloud_area, icloud_etag')
      .eq('id', q.entity_id).eq('user_id', userId).maybeSingle()
    if (error) throw new ICloudError('read', 'A slot could not be read')
    if (!b) {
      await removeOld('slot', q.entity_id, null, q.area)
      return q.area ? 'removed' : 'none'
    }
    let t: { status: string; description: string | null; google_target: string | null; domain: string | null; source_type: string | null; project_id: string | null; hevy_routine_id: string | null } | null = null
    if (b.task_id) {
      const { data, error: te } = await db.from('tasks').select('status, description, google_target, domain, source_type, project_id, hevy_routine_id').eq('id', b.task_id).eq('user_id', userId).maybeSingle()
      if (te) throw new ICloudError('read', 'A slot\'s task could not be read')
      t = data
    }
    const area = itemArea({ category: b.category, source_type: b.source_type, task_source_type: t?.source_type, domain: t?.domain, project_id: t?.project_id, hevy_routine_id: t?.hevy_routine_id })
    const conf = prefs.areas[area]
    // A slot with no task is on a calendar only where it is now (itemRules.presentGoogleTarget).
    const wanted = wantsCalendar(t ? t.google_target : null, !!(b.google_calendar_event_id || b.icloud_area))
    if (wanted && conf.enabled && conf.app === 'apple') {
      const url = ownEventUrl('slot', b.id, area, areaCals)
      if (!url) throw new ICloudError('calendars', NO_AREA_CALENDAR)
      const ev = slotEvent(b, { done: t?.status === 'done', taskNotes: t?.description, area: conf, timeZone: SERVER_EVENT_TIME_ZONE, appUrl: APP_URL, now: new Date() })
      if (ev) {
        const etag = await putEvent(c, url, ev.ics, b.icloud_area === area ? b.icloud_etag : null)
        if (!(await link('time_blocks', b.id, b.icloud_area, { icloud_area: area, icloud_etag: etag }))) {
          // Deleted while it was being written: the copy just made goes again — unless another run linked this very copy.
          if ((await linkedArea('time_blocks', b.id)) === area) return 'put'
          await removeOwnEvent(c, 'slot', b.id, area, areaCals)
          return 'removed'
        }
        await removeOld('slot', b.id, area, b.icloud_area, q.area)
        return 'put'
      }
    }
    if (!b.icloud_area && !q.area) return 'none'
    await removeOld('slot', b.id, null, b.icloud_area, q.area)
    if (b.icloud_area) await link('time_blocks', b.id, b.icloud_area, { icloud_area: null, icloud_etag: null })
    return 'removed'
  }

  const { data: p, error } = await db.from('schedule_blocks')
    .select('id, title, start_time, end_time, busy, days_of_week, repeat_kind, repeat_interval, repeat_unit, repeat_dates, effective_from, except_dates, category, domain, google_target, notes, google_calendar_event_id, google_calendar_time_zone, google_calendar_from, icloud_area, icloud_etag, icloud_from, icloud_horizon')
    .eq('id', q.entity_id).eq('user_id', userId).maybeSingle()
  if (error) throw new ICloudError('read', 'A repeating plan could not be read')
  if (!p) {
    await removeOld('plan', q.entity_id, null, q.area)
    return q.area ? 'removed' : 'none'
  }
  const area = itemArea({ category: p.category, domain: p.domain })
  const conf = prefs.areas[area]
  const wanted = wantsCalendar(p.google_target, !!(p.google_calendar_event_id || p.icloud_area))
  if (wanted && conf.enabled && conf.app === 'apple') {
    const url = ownEventUrl('plan', p.id, area, areaCals)
    if (!url) throw new ICloudError('calendars', NO_AREA_CALENDAR)
    // A series that was on Google keeps its start (its past days stay on the calendar).
    const from = p.icloud_from ?? p.google_calendar_from ?? null
    const ev = planEvent({ ...p, icloud_from: from }, { area: conf, today, timeZone: seriesTimeZone(p.google_calendar_time_zone), appUrl: APP_URL, now: new Date() })
    if (ev) {
      const etag = await putEvent(c, url, ev.ics, p.icloud_area === area ? p.icloud_etag : null)
      if (!(await link('schedule_blocks', p.id, p.icloud_area, { icloud_area: area, icloud_etag: etag, icloud_from: from ?? ev.plan.from ?? today, icloud_horizon: ev.plan.horizon }))) {
        if ((await linkedArea('schedule_blocks', p.id)) === area) return 'put'
        await removeOwnEvent(c, 'plan', p.id, area, areaCals)
        return 'removed'
      }
      await removeOld('plan', p.id, area, p.icloud_area, q.area)
      return 'put'
    }
  }
  if (!p.icloud_area && !q.area) return 'none'
  await removeOld('plan', p.id, null, p.icloud_area, q.area)
  if (p.icloud_area) await link('schedule_blocks', p.id, p.icloud_area, { icloud_area: null, icloud_etag: null, icloud_from: null, icloud_horizon: null })
  return 'removed'
}

function osloTomorrow(now: Date): string {
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })
  return nextDay(today)
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}

Deno.serve(async (req) => {
  const headers = { ...corsHeaders(req.headers.get('origin')), 'Content-Type': 'application/json' }
  const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (req.method !== 'POST') return answer({ error: 'POST only' }, 405)

  const authHeader = req.headers.get('authorization')
  if (!authHeader) return answer({ error: 'Missing authorization' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data: { user }, error: authError } = await db.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return answer({ error: 'Invalid token' }, 401)
  if (!(await isAppUser(user.id))) return answer({ error: 'forbidden' }, 403)

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return answer({ error: 'Bad request' }, 400) }
  const action = String(body.action ?? '')

  // The password is read only for the actions that call iCloud.
  const needsPassword = action === 'check' || action === 'changes' || action === 'read' || action === 'setup' || action === 'drain' || action === 'remove'
  const { data: row, error: readError } = await db.from('icloud_credentials')
    .select(`apple_id, ${needsPassword ? 'app_password, ' : ''}calendar_home_url, test_calendar_url, test_sync_token, last_error, last_check, area_calendars, password_sealed, connected_at`)
    .eq('user_id', user.id).maybeSingle() as {
      data: {
        apple_id: string; app_password?: string; calendar_home_url: string | null; test_calendar_url: string | null; test_sync_token: string | null
        last_error: string | null; last_check: unknown; area_calendars: Record<string, { url?: string }> | null; password_sealed: boolean | null; connected_at: string
      } | null
      error: { message: string } | null
    }
  // A failed read is not "not connected": the card would offer Connect, and Apple shows a password only once.
  if (readError) {
    console.error(`icloud-calendar ${action}: read`)
    return answer({ error: /icloud_credentials|last_check|area_calendars|password_sealed/.test(readError.message) ? 'Apple Calendar needs migrations 171 and 172 — they run with the next deploy' : 'The iCloud connection could not be read — try again' }, 502)
  }
  const status = (r: typeof row) => (r
    ? {
        connected: true, appleId: maskAppleId(r.apple_id), connectedAt: r.connected_at, lastError: r.last_error,
        hasTest: !!r.test_calendar_url, testIsApps: !!r.test_calendar_url?.endsWith(`/${TEST_SLUG}`), lastCheck: r.last_check ?? null,
        // Derived only: whether each area has its calendar in iCloud, and whether the password is stored sealed.
        areas: Object.fromEntries(AREA_KEYS.map(k => [k, { ready: !!r.area_calendars?.[k]?.url }])),
        passwordSealed: !!r.password_sealed,
      }
    : { connected: false })

  try {
    if (action === 'status') return answer(status(row))

    if (action === 'connect') {
      const email = String(body.appleId ?? '').trim()
      const password = String(body.appPassword ?? '').trim().toLowerCase()
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return answer({ error: 'Write the Apple ID email' }, 400)
      if (!isAppSpecificPassword(password)) {
        return answer({ error: 'That is not an app-specific password (four groups of four letters, like abcd-efgh-ijkl-mnop). Never use your Apple ID password here.' }, 400)
      }
      // The password is only ever stored sealed: no key, no connect.
      const key = await sealKey(Deno.env.get('ICLOUD_ENC_KEY'))
      if (!key) return answer({ error: keyProblem() }, 400)
      const creds = { email, password }
      const { principal, home } = await discover(creds)
      const { error } = await db.from('icloud_credentials').upsert({
        user_id: user.id, apple_id: email, app_password: await sealSecret(password, key, user.id), principal_url: principal, calendar_home_url: home,
        // Another Apple ID's calendars are not this one's.
        test_calendar_url: null, test_sync_token: null, last_check: null, area_calendars: {}, last_error: null, connected_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      if (error) throw new ICloudError('store', /icloud_credentials/.test(error.message) ? 'Connecting iCloud needs migrations 171 and 172 — they run with the next deploy' : 'The connection could not be saved')
      return answer(status({
        apple_id: email, calendar_home_url: home, test_calendar_url: null, test_sync_token: null, last_error: null, last_check: null,
        area_calendars: {}, password_sealed: true, connected_at: new Date().toISOString(),
      }))
    }

    if (action === 'disconnect') {
      const { error } = await db.from('icloud_credentials').delete().eq('user_id', user.id)
      if (error) throw new ICloudError('store', 'The stored password could not be deleted — try again')
      return answer({ connected: false })
    }

    if (!row || !row.app_password) return answer({ error: 'Connect iCloud first' }, 400)
    const key = await sealKey(Deno.env.get('ICLOUD_ENC_KEY'))
    const password = await openSecret(row.app_password, key, user.id)
    if (password === null) {
      throw new ICloudError('sealed', key ? 'The stored password can\'t be opened with the current key — disconnect, then connect with a new app-specific password from account.apple.com' : keyProblem())
    }
    // A password stored before sealing is sealed now, the first time a key is there (tried again on the next call if it fails).
    if (key && !isSealed(row.app_password)) {
      const { error } = await db.from('icloud_credentials').update({ app_password: await sealSecret(password, key, user.id) }).eq('user_id', user.id)
      if (error) console.error(`icloud-calendar ${action}: reseal`)
    }
    const creds = { email: row.apple_id, password }
    const home = row.calendar_home_url ?? (await discover(creds)).home

    if (action === 'check') {
      const steps: Step[] = []
      const cal = await ensureTestCalendar(creds, home, row.test_calendar_url, steps)
      if (!cal) {
        return answer({ steps, needsCalendar: true, message: 'iCloud didn\'t let the app make a calendar. On your iPhone: Calendar → Calendars → Add Calendar → name it "Lasci Test" (in iCloud), then run the check again.' })
      }
      // Saved before any event is written: whatever fails next, Remove can still find them.
      await db.from('icloud_credentials').update({ test_calendar_url: cal.url, test_sync_token: null }).eq('user_id', user.id)
      const events = checkEvents(osloTomorrow(new Date()), new Date(), APP_URL)
      const written: { ev: CheckEvent; href: string; ok: boolean; status: number }[] = []
      for (const ev of events) {
        const href = new URL(`${ev.uid.replace(/[^a-z0-9-]/gi, '-')}.ics`, cal.url).toString()
        const r = await dav(creds, 'PUT', href, ev.ics)
        written.push({ ev, href, ok: r.status === 201 || r.status === 204, status: r.status })
      }
      steps.push({ step: 'Write the test events', ok: written.every(w => w.ok), detail: `${written.filter(w => w.ok).length} of ${written.length} taken by iCloud` })
      let stored = new Map<string, string>()
      try {
        stored = await multiget(creds, cal.url, written.filter(w => w.ok).map(w => new URL(w.href).pathname))
        steps.push({ step: 'Read them back', ok: stored.size === written.filter(w => w.ok).length, detail: `${stored.size} read back` })
      } catch (e) {
        if (e instanceof ICloudError && e.code === 'auth') throw e
        steps.push({ step: 'Read them back', ok: false, detail: e instanceof ICloudError ? e.message : 'iCloud did not answer' })
      }
      const token = await syncToken(creds, cal.url)
      steps.push({ step: 'Changes since (sync token)', ok: !!token, detail: token ? 'iCloud gave a sync token — "Check changes" can follow your edits' : 'iCloud gave no sync token' })
      const result = {
        steps,
        calendar: cal.name,
        day: osloTomorrow(new Date()),
        events: written.map(w => {
          const ics = stored.get(new URL(w.href).pathname)
          const kept = ics ? keptOf(eventProps(ics)) : null
          return { key: w.ev.key, label: w.ev.label, written: w.ok, status: w.status, kept: kept ? Object.fromEntries(w.ev.expect.map(k => [k, kept[k]])) : null }
        }),
      }
      // Kept so the card still shows what to look for after the trip to the Calendar app (no password or URL in it).
      await db.from('icloud_credentials').update({ test_sync_token: token, last_check: result, last_error: null }).eq('user_id', user.id)
      return answer(result)
    }

    if (action === 'changes') {
      if (!row.test_calendar_url || !row.test_sync_token) return answer({ error: 'Run the Apple check first' }, 400)
      const r = await dav(creds, 'REPORT', row.test_calendar_url,
        `${XML}<d:sync-collection ${NS}><d:sync-token>${escapeXml(row.test_sync_token)}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`,
        { Depth: '0' })
      if (r.status !== 207) return answer({ tokenWorked: false, message: `iCloud doesn't report changes this way (it answered ${r.status}) — Phase 2 would read the whole calendar again instead`, changes: [] })
      const parsed = parseMultistatus(r.text)
      const changed = parsed.responses.filter(x => x.status !== 404 && x.href.endsWith('.ics'))
      const removed = parsed.responses.filter(x => x.status === 404)
      const stored = await multiget(creds, row.test_calendar_url, changed.map(x => new URL(x.href, r.url).pathname))
      const changes = [
        ...[...stored.values()].map(ics => ({ kind: 'changed' as const, ...changeOf(eventProps(ics)) })),
        ...removed.map(() => ({ kind: 'removed' as const, title: 'An event', starts: '–' })),
      ]
      await db.from('icloud_credentials').update({ ...(parsed.syncToken ? { test_sync_token: parsed.syncToken } : {}), last_error: null }).eq('user_id', user.id)
      return answer({ tokenWorked: true, changes })
    }

    // Read-only (owner, 29.10.2026: "Build that"): the owner's own calendars, today and the next 6 days,
    // to compare with the iPhone. Nothing is stored or logged — the titles go only to the owner's browser.
    if (action === 'read') {
      const win = readWindow(new Date())
      const list = await propfind(creds, home, '<d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/>', '1')
      const found = calendarsOf(list.responses)
      const calendars: { name: string; color: string | null; events: ReadEvent[]; problem: string | null }[] = []
      for (const cal of found.slice(0, MAX_READ_CALENDARS)) {
        const entry = { name: cal.name, color: cal.color, events: [] as ReadEvent[], problem: null as string | null }
        calendars.push(entry)
        try {
          const r = await dav(creds, 'REPORT', new URL(cal.href, list.url).toString(), calendarQuery(win.start, win.end), { Depth: '1' })
          if (r.status !== 207) { entry.problem = `iCloud answered ${r.status}`; continue }
          entry.events = parseMultistatus(r.text).responses.flatMap(x => { const d = xmlText(x.props, 'calendar-data'); return d ? readEventsOf(d) : [] })
        } catch (e) {
          if (e instanceof ICloudError && e.code === 'auth') throw e
          entry.problem = e instanceof ICloudError ? e.message : 'iCloud did not answer'
        }
      }
      const repeats = calendars.flatMap(c => c.events).filter(e => e.repeats)
      const { days, series } = byDay(calendars, win.fromDay, win.toDay)
      await db.from('icloud_credentials').update({ last_error: null }).eq('user_id', user.id)
      return answer({
        fromDay: win.fromDay, toDay: win.toDay,
        // Did iCloud split repeating events into their days (CalDAV expand)? null: nothing repeats this week.
        expanded: repeats.length ? !repeats.some(e => e.series) : null,
        calendars: calendars.map(c => ({ name: c.name, color: c.color, count: c.events.length, problem: c.problem })),
        skipped: Math.max(0, found.length - MAX_READ_CALENDARS),
        // No calendar found: what iCloud listed instead, by kind only (no names, no addresses).
        listing: found.length ? null : listingKinds(list.responses),
        days: days.map(d => ({ day: d.day, events: d.events.slice(0, MAX_READ_PER_DAY), more: Math.max(0, d.events.length - MAX_READ_PER_DAY) })),
        series,
      })
    }

    // Phase 2a: the app's calendars, one per area, made in iCloud or brought up to date (name, colour).
    // No event is written yet. A calendar switched off stays in iCloud as it is.
    if (action === 'setup') {
      const { data: prefsRow, error: prefsError } = await db.from('calendar_prefs').select('prefs').eq('user_id', user.id).maybeSingle()
      if (prefsError) throw new ICloudError('prefs', /calendar_prefs/.test(prefsError.message) ? 'Calendar settings need migration 172 — it runs with the next deploy' : 'The calendar settings could not be read — try again')
      const prefs = readCalendarPrefs(prefsRow?.prefs)
      const known: Record<string, { url?: string }> = { ...(row.area_calendars ?? {}) }
      const areas: { area: AreaKey; name: string; state: 'created' | 'updated' | 'found' | 'off' | 'failed'; detail?: string }[] = []
      for (const key of AREA_KEYS) {
        const area = prefs.areas[key]
        if (!area.enabled) { areas.push({ area: key, name: area.name, state: 'off' }); continue }
        try {
          const placed = await placeAreaCalendar(creds, home, known[key]?.url ?? null, key, area)
          known[key] = { url: placed.url }
          areas.push({ area: key, name: area.name, state: placed.state })
        } catch (e) {
          if (e instanceof ICloudError && e.code === 'auth') throw e
          areas.push({ area: key, name: area.name, state: 'failed', detail: e instanceof ICloudError ? e.message : 'iCloud did not answer' })
        }
      }
      // A calendar not made is kept as the last problem until a run makes it, so a reload still says why.
      const notMade = areas.filter(a => a.state === 'failed')
      const lastError = notMade.length ? `Not made in Apple Calendar: ${notMade.map(a => `${a.name} (${a.detail})`).join('; ')}` : null
      const { error } = await db.from('icloud_credentials').update({ area_calendars: known, last_error: lastError }).eq('user_id', user.id)
      if (error) throw new ICloudError('store', 'The calendars are in iCloud, but the app could not save where they are — run it again')
      // Events that waited for a calendar to exist go now (best effort: the queue is retried anyway).
      await db.from('icloud_outbox').update({ next_try_at: new Date().toISOString(), attempts: 0 }).eq('user_id', user.id)
      return answer({ areas })
    }

    // Phase 2b: what changed goes to Apple Calendar — after a save, when the app opens, and on a timer (2b-2).
    // Each queued slot or plan is read live; a row goes only while requested_at is what was read (a newer change waits).
    if (action === 'drain') {
      const started = Date.now()
      // One drain at a time per account: a short lease (a crashed run's lapses on its own).
      const nowIso = new Date().toISOString()
      const lease = new Date(Date.now() + DRAIN_LEASE_MS).toISOString()
      const { data: leased, error: leaseError } = await db.from('icloud_credentials')
        .update({ drain_until: lease })
        .eq('user_id', user.id).or(`drain_until.is.null,drain_until.lt.${nowIso}`).select('user_id')
      if (leaseError) throw new ICloudError('queue', /drain_until/.test(leaseError.message) ? 'Apple Calendar events need migration 173 — it runs with the next deploy' : 'The queue could not be read')
      if (!(leased ?? []).length) return answer({ busy: true })
      try {
        // Settings that can't be read are never guessed: the defaults would read every area as Google and remove events.
        const { data: prefsRow, error: prefsError } = await db.from('calendar_prefs').select('prefs').eq('user_id', user.id).maybeSingle()
        if (prefsError) throw new ICloudError('prefs', 'The calendar settings could not be read — nothing was changed in Apple Calendar')
        const prefs = readCalendarPrefs(prefsRow?.prefs)
        const today = osloClock(new Date()).day
        // A monthly kind's RDATE list runs a year ahead: renewed when under 90 days are left (Google: needsHorizonTopUp).
        const { data: ending } = await db.from('schedule_blocks').select('id, icloud_area')
          .eq('user_id', user.id).not('icloud_area', 'is', null).not('icloud_horizon', 'is', null)
          .lt('icloud_horizon', addDaysIso(today, SERIES_TOPUP_DAYS))
        if ((ending ?? []).length) {
          await db.from('icloud_outbox').upsert((ending ?? []).map(e => ({ user_id: user.id, entity: 'plan', entity_id: e.id, area: e.icloud_area })), { onConflict: 'user_id,entity,entity_id', ignoreDuplicates: true })
        }
        const { data: queue, error: qError } = await db.from('icloud_outbox')
          .select('id, entity, entity_id, area, requested_at, attempts')
          .eq('user_id', user.id).lte('next_try_at', new Date().toISOString())
          .order('requested_at', { ascending: true }).limit(DRAIN_MAX_ROWS)
        if (qError) throw new ICloudError('queue', 'The queue could not be read')
        const counts = { put: 0, removed: 0, none: 0, failed: 0 }
        for (const q of (queue ?? []) as QueueRow[]) {
          if (Date.now() - started > DRAIN_MAX_MS) break
          try {
            counts[await drainOne(db, creds, user.id, q, prefs, row.area_calendars ?? {}, today)]++
            await db.from('icloud_outbox').delete().eq('id', q.id).eq('user_id', user.id).eq('requested_at', q.requested_at)
          } catch (e) {
            if (e instanceof ICloudError && e.code === 'auth') throw e
            counts.failed++
            // An event the guard refused (a control character in a field) says so; anything else is iCloud's.
            const why = e instanceof ICloudError ? e.message : e instanceof Error && /control character/.test(e.message) ? e.message : 'iCloud did not answer'
            await db.from('icloud_outbox').update({ attempts: q.attempts + 1, next_try_at: retryAt(q.attempts + 1), last_error: why })
              .eq('id', q.id).eq('user_id', user.id).eq('requested_at', q.requested_at)
          }
        }
        const { count: waiting } = await db.from('icloud_outbox').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
        // The account's "Last problem" stays setup's (a drain's problems live on their own queue rows).
        return answer({ ...counts, waiting: waiting ?? 0 })
      } finally {
        // Only this run's own lease is given back (a run that outlived it never frees the next run's).
        await db.from('icloud_credentials').update({ drain_until: null }).eq('user_id', user.id).eq('drain_until', lease)
      }
    }

    if (action === 'remove') {
      if (!row.test_calendar_url) return answer({ removed: null, message: 'No test calendar to remove' })
      // Only the calendar the app made, holding nothing but the check's events, goes whole; otherwise only the check's events go.
      const members = await propfind(creds, row.test_calendar_url, '<d:getetag/>', '1')
      const onlyOurs = members.responses
        .map(m => new URL(m.href, members.url).pathname)
        .filter(p => p !== new URL(row.test_calendar_url!).pathname)
        .every(p => /\/lasci-check-[a-z]+-lasciviens-github-io\.ics$/.test(p))
      let removed: 'calendar' | 'events'
      if (row.test_calendar_url.endsWith(`/${TEST_SLUG}`) && onlyOurs) {
        const r = await dav(creds, 'DELETE', row.test_calendar_url)
        if (r.status >= 300 && r.status !== 404) return answer({ error: `iCloud answered ${r.status} — the test calendar is still there` }, 502)
        removed = 'calendar'
      } else {
        for (const ev of checkEvents(osloTomorrow(new Date()), new Date(), APP_URL)) {
          const r = await dav(creds, 'DELETE', new URL(`${ev.uid.replace(/[^a-z0-9-]/gi, '-')}.ics`, row.test_calendar_url).toString())
          if (r.status >= 300 && r.status !== 404) return answer({ error: `iCloud answered ${r.status} — some test events are still there` }, 502)
        }
        removed = 'events'
      }
      await db.from('icloud_credentials').update({ test_calendar_url: null, test_sync_token: null, last_check: null, last_error: null }).eq('user_id', user.id)
      return answer({ removed })
    }

    return answer({ error: 'Unknown action' }, 400)
  } catch (e) {
    // The message names no password, header or account URL (ICloudError texts only).
    const message = e instanceof ICloudError ? e.message : 'Something went wrong talking to iCloud'
    if (row) await db.from('icloud_credentials').update({ last_error: message }).eq('user_id', user.id)
    console.error(`icloud-calendar ${action}: ${e instanceof ICloudError ? e.code : 'unexpected'}`)
    // Apple refusing the password is not this app's sign-in failing: 400, never 401.
    return answer({ error: message }, e instanceof ICloudError && e.code === 'auth' ? 400 : 502)
  }
})
