// ─────────────────────────────────────────────────────────────────────────────
//  The item screen's own rules (step 1 of docs/features/item-screen-plan.md) —
//  pure, checked by scripts/verify-item-screen.cjs.
//
//  The screen draws Apple Calendar's Starts / Ends, while the item is stored
//  as it always was: a day, a start time and a length in minutes (1–1440,
//  080's CHECK). Ends is read from the start and the length; an end picked on
//  the Ends row is read back into the length, so it may be the next day but
//  at most 24 hours after the start. Moving the start (its day or its time)
//  keeps the length, so the end moves with it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  addDaysIso, dayNumber, MAX_REPEAT_COUNT, nextOccurrences, occurrencesBetween, type RepeatRule,
} from '../../../features/daily/recurrence'
import { eventUrl } from '../../../features/calendar/calendarEventRules'
import { cleanItemUrl } from '../../../features/items/itemCalendarFields'
import { notInAppleText, type AppleSend } from '../../../features/calendar/areas/appleSendRules'
import type { GoogleTarget } from '../../../features/items/itemTypes'

export const DAY_MINUTES = 1440
/** The wheels and the timeline move in five-minute steps, as the iPhone's Calendar does. */
export const STEP_MINUTES = 5

const pad = (n: number) => String(n).padStart(2, '0')
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** "17:30" → 1050. */
export function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
}

/** 1050 → "17:30" (wrapping within a day). */
export function timeOfMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** Where an item ends: its start plus its length — the next day when it runs past midnight. */
export function endOf(date: string, time: string, duration: number): { date: string; time: string } {
  const abs = minutesOf(time) + duration
  return { date: addDaysIso(date, Math.floor(abs / DAY_MINUTES)), time: timeOfMinutes(abs) }
}

export type EndProblem = 'before' | 'too-long'
export const END_PROBLEM_TEXT: Record<EndProblem, string> = {
  before: 'It ends before it starts',
  'too-long': 'It can end at most 24 hours after it starts',
}

/**
 * The end a time wheel picks when the Ends row shows no day (a saved weekly repeat: its rows show times only): an end
 * at or before the start is the next day — the only way it can be one (a length of at most 24 hours).
 */
export function endOnWheel(date: string, start: string, endTime: string, dayShown: boolean): { date: string; time: string } {
  return { date: !dayShown && minutesOf(endTime) <= minutesOf(start) ? addDaysIso(date, 1) : date, time: endTime }
}

/** An end picked on the Ends row, read back as the item's length — or why it can't be one. */
export function lengthToEnd(start: { date: string; time: string }, end: { date: string; time: string }): { duration: number } | { problem: EndProblem } {
  const length = (dayNumber(end.date) - dayNumber(start.date)) * DAY_MINUTES + minutesOf(end.time) - minutesOf(start.time)
  if (length <= 0) return { problem: 'before' }
  if (length > DAY_MINUTES) return { problem: 'too-long' }
  return { duration: length }
}

// ── The timeline ─────────────────────────────────────────────────────────────

export type DragMode = 'move' | 'start' | 'end'

/**
 * A drag on the timeline, `delta` minutes from where it began (snapped to five). Move keeps the length (the end may
 * pass midnight); the start grip keeps the end; the end grip keeps the start and stops at midnight. An item with no
 * length is a point in time: its end grip gives it one.
 */
export function dragTimes(mode: DragMode, start0: number, length0: number | null, delta: number): { start: number; length: number | null } {
  const d = Math.round(delta / STEP_MINUTES) * STEP_MINUTES
  const length = length0 ?? 0
  if (mode === 'move' || (mode === 'start' && !length0)) {
    return { start: clamp(start0 + d, 0, DAY_MINUTES - STEP_MINUTES), length: length0 }
  }
  if (mode === 'start') {
    const end = start0 + length
    const start = clamp(start0 + d, Math.max(0, end - DAY_MINUTES), end - STEP_MINUTES)
    return { start, length: end - start }
  }
  const end = clamp(start0 + length + d, start0 + STEP_MINUTES, Math.max(start0 + STEP_MINUTES, DAY_MINUTES))
  return { start: start0, length: end - start0 }
}

/** A keyboard step on the timeline's bar: arrows move it, Shift + arrows change its end. */
export function nudgeTimes(start: number, length: number | null, dir: -1 | 1, changeEnd: boolean): { start: number; length: number | null } {
  return dragTimes(changeEnd ? 'end' : 'move', start, length, dir * STEP_MINUTES)
}

export interface DaySpan {
  id: string
  title: string
  /** Minutes from midnight on the timeline's day, clipped to [0, 1440]. */
  start: number
  end: number
}

/** Things that overlap each other share the day in two lanes; a day without overlaps uses one taller lane. */
export function spanLanes(spans: readonly DaySpan[]): { lanes: Map<string, 0 | 1>; two: boolean } {
  const ends: number[] = []
  const lanes = new Map<string, 0 | 1>()
  for (const s of [...spans].sort((a, b) => a.start - b.start || a.end - b.end)) {
    let lane = ends.findIndex(e => e <= s.start)
    if (lane === -1) lane = Math.min(ends.length, 1)
    ends[lane] = Math.max(ends[lane] ?? 0, s.end)
    lanes.set(s.id, lane as 0 | 1)
  }
  return { lanes, two: ends.length > 1 }
}

/** The day's other things this item overlaps (a point in time overlaps what it falls inside). */
export function overlapsOf(spans: readonly DaySpan[], start: number, length: number | null): DaySpan[] {
  const end = start + Math.max(length ?? 0, 0)
  return spans.filter(s => (length ? s.start < end && s.end > start : s.start <= start && s.end > start))
}

/** Where the timeline opens: the item in the middle (a whole day, or none: 08:00–18:00). */
export function timelineCentre(start: number | null, length: number | null): number {
  if (start === null) return 13 * 60
  return Math.min(DAY_MINUTES, start + (length ?? 0) / 2)
}

// ── Where each field goes (the marks, Settings → Calendar) ────────────────────

export type FieldGoes = 'apple' | 'google-calendar' | 'google-tasks' | 'app'
/** A row's field. Step 2's (193): `alerts` (Alert, Second Alert), `showAs`, `url`, `travel`, `repeatEnd`. `time` is the
 *  day (the Date row, a day without a time); `clock` the time of day, its length and zone (All-day, Starts and Ends with
 *  a time, Time Zone). */
export type ScreenField = 'title' | 'notes' | 'time' | 'clock' | 'place' | 'repeat' | 'calendar' | 'deadline' | 'list' | 'own'
  | 'alerts' | 'showAs' | 'url' | 'travel' | 'repeatEnd'

export const FIELD_GOES_TEXT: Record<FieldGoes, string> = {
  apple: 'Goes to Apple Calendar',
  'google-calendar': 'Goes to Google Calendar',
  'google-tasks': 'Goes to Google Tasks',
  app: 'Stays in the app',
}

export interface GoesContext {
  /** Where the item saves to (the Calendar row's choice; 'none' when the device has no choice to show). */
  target: GoogleTarget
  /** The calendar app of the item's area (Settings → Calendar). */
  calendarApp: 'google' | 'apple'
  /** It has a day: a calendar needs one. */
  dated: boolean
  /** What Apple Calendar's notes carry (Settings → Calendar → Every Apple Calendar event). */
  appleNotes?: boolean
}

/**
 * Where one field of the item goes: the item's calendar (Apple or Google) when it is on one, Google Tasks for what a
 * Google Task carries (its title, notes, day, deadline, list, one task per day of a repeat), else only the app. The
 * app's own fields (priority, labels, area, category, the window) always stay in the app. Step 2's fields (193): the
 * alerts and Show As go to either calendar (a Google Task has neither); the link and the travel time only to Apple's
 * (Google Calendar has no field for them); End Repeat goes where the repeat goes. A Google Task has a day but no time:
 * the time of day, its length and zone go only to a calendar (`clock`).
 */
export function fieldGoes(field: ScreenField, ctx: GoesContext): FieldGoes {
  const calendar: FieldGoes | null = ctx.dated && (ctx.target === 'calendar' || ctx.target === 'both')
    ? (ctx.calendarApp === 'apple' ? 'apple' : 'google-calendar') : null
  const tasks = ctx.target === 'tasks' || ctx.target === 'both'
  const viaTasks: FieldGoes = tasks ? 'google-tasks' : 'app'
  switch (field) {
    case 'own': return 'app'
    case 'list': return tasks ? 'google-tasks' : 'app'
    case 'deadline': return viaTasks
    case 'place': return calendar ?? 'app'
    case 'alerts':
    case 'showAs':
    case 'clock': return calendar ?? 'app'
    case 'url':
    case 'travel': return calendar === 'apple' ? 'apple' : 'app'
    case 'notes':
      if (calendar === 'apple' && ctx.appleNotes === false) return viaTasks
      return calendar ?? viaTasks
    default: return calendar ?? viaTasks
  }
}

// ── Which parts the screen shows ─────────────────────────────────────────────

/**
 * The item's shape as the screen draws it: one day of a repeat ("This day"), a repeat, the Calendar row, an all-day
 * item on a calendar, and the rows a slot or a repeat keeps — Location, Travel Time, Alert, Second Alert, Show As and
 * URL (186, 193: a task alone has nowhere to keep them). A slot is made for a time, a repeat or a whole day on a
 * calendar. The screen and the save's checks read the same answer, so a field the screen hides never blocks a save.
 */
export function screenParts(
  f: { recurrence: string; scope: 'day' | 'all'; time: string | null },
  ctx: { occurrenceDate?: string | null; choiceShown: boolean; calendarHidden: boolean; target: GoogleTarget },
): { day: boolean; repeating: boolean; showGoogle: boolean; allDay: boolean; slotFields: boolean } {
  const day = !!ctx.occurrenceDate && f.scope === 'day'
  const repeating = f.recurrence !== 'none' && !day
  const showGoogle = ctx.choiceShown && !day && !ctx.calendarHidden
  const allDay = showGoogle && !f.time && (ctx.target === 'calendar' || ctx.target === 'both')
  return { day, repeating, showGoogle, allDay, slotFields: !!f.time || repeating || allDay }
}

// ── End Repeat's first values ────────────────────────────────────────────────

/** How many times ahead End Repeat's first value reaches. */
export const END_REPEAT_AHEAD = 10

/**
 * End Repeat's first values when "On a day" or "After N times" is picked (an edit saves it at once): the tenth time
 * from today — or from the start, when that is later — as the day, and as the count from the start (the database
 * counts from effective_from, days taken out included, so countEndDay of that count is that day). A saved repeat that
 * began long ago is never ended in the past by a default. With no tenth time ahead (picked dates), the last one.
 */
export function endRepeatDefaults(rule: RepeatRule, today: string): { until: string; count: number } {
  const from = rule.effective_from && rule.effective_from > today ? rule.effective_from : today
  const open = { ...rule, repeat_until: null, repeat_count: null }
  const ahead = nextOccurrences(open, from, END_REPEAT_AHEAD)
  const until = ahead[ahead.length - 1] ?? addDaysIso(from, 30)
  const hits = rule.effective_from ? occurrencesBetween({ ...open, except_dates: [] }, rule.effective_from, until).length : 0
  return { until, count: Math.min(MAX_REPEAT_COUNT, Math.max(1, hits || END_REPEAT_AHEAD)) }
}

// ── The URL row's link ───────────────────────────────────────────────────────

/**
 * The address the URL row may open: the typed link as it would be stored (cleanItemUrl), and only when the writers
 * would use it too (eventUrl: https, a host name, URL characters only) — else null, and nothing is offered to open.
 * A link can come from the iPhone (the read-back), so it is checked here, not trusted.
 */
export function openableUrl(typed: string): string | null {
  const clean = cleanItemUrl(typed)
  const href = 'url' in clean ? eventUrl(clean.url) : null
  return href && hostOf(href).length <= 253 ? href : null // DNS's own limit: a longer host is never real
}

/** The host a link opens, as the browser reads it — punycode for a non-Latin name, so a look-alike host shows. */
export function hostOf(href: string): string {
  try { return new URL(href).host } catch { return href }
}

// ── What an edit holds back until the screen closes ───────────────────────────

/**
 * An edit saves by itself, except a change that must wait for the screen to close: a new Google Tasks list's name
 * still being typed (each saved word would make a list on Google), and a change that takes the slot away — no day,
 * or no time, where the saved item had one (the slot goes with its colour, its episode and its calendar event). A
 * stray tap on Date or All-day, turned back before the screen closes, then sends nothing. Null: nothing waits.
 */
export function heldChange(
  f: { date: string | null; time: string | null; shown: readonly string[] },
  saved: { date?: string | null; time?: string | null },
): string | null {
  if (f.shown.includes('list')) return 'Saves when the list name is done'
  if ((saved.date && !f.date) || (saved.time && !f.time)) return 'Saves when you close it'
  return null
}

// ── The Calendar row's red dot ───────────────────────────────────────────────

/** How long a change may take to reach Apple Calendar (the save sends it at once; the timer every 5 minutes). */
export const APPLE_SEND_GRACE_MS = 2 * 60_000

/**
 * The row's own guess, for when the queue gave no answer for it (another send was running, an older server): it
 * belongs in Apple Calendar (its area is there and it wants a calendar), yet its slot or plan still has no Apple copy
 * two minutes after its last change.
 */
export function appleRefused(row: { icloud_area?: string | null; updated_at?: string | null } | null | undefined, wantsApple: boolean, now: number): boolean {
  if (!row || !wantsApple || row.icloud_area) return false
  const changed = row.updated_at ? Date.parse(row.updated_at) : NaN
  return Number.isFinite(changed) && now - changed > APPLE_SEND_GRACE_MS
}

/**
 * The Calendar row's red dot: why an item that belongs in Apple Calendar isn't there, or null. Read from the queue's
 * own answer for the item's row (`send`: the screen sends that row when it opens — appleAreas.drainICloudNow with the
 * row named — and the server says what it did with it): sent or kept = no dot; failed, waiting, not queued, or a
 * calendar that doesn't go there = the dot with the reason (appleSendRules.notInAppleText, the save's own words). With
 * no answer for the row (another send was running, an older server, not asked yet) the row's guess stands
 * (appleRefused), with the account's newest reason when Settings' status had one (`notSent`).
 */
export function appleDot(i: {
  wanted: boolean
  row: { icloud_area?: string | null; updated_at?: string | null } | null | undefined
  send: AppleSend | null
  notSent?: { count: number; reason: string | null } | null
  now: Date
}): string | null {
  if (!i.wanted || !i.row || i.row.icloud_area) return null
  const s = i.send
  const said = (send: AppleSend) => notInAppleText({ ...send, keepsGoogleTask: false, now: i.now })
  if (s && !s.busy && s.item) return s.item.status === 'sent' || s.item.status === 'kept' ? null : said(s)
  if (s && !s.busy && s.problem) return said(s)
  if (!appleRefused(i.row, true, i.now.getTime())) return null
  return said({ item: null, problem: i.notSent?.count ? i.notSent.reason : null, busy: false })
}

// ── Opening the screen at a row ──────────────────────────────────────────────

/**
 * "Move to list…" on a task opens the item screen at its List row when the screen shows that row: the task goes to
 * Google Tasks (its saved choice, or — an older row — while it syncs there) and this device can show the Google
 * choice. Otherwise the list sheet stays (a task not on Google Tasks still picks the list its first copy will use).
 */
export function opensListRow(task: { google_target?: GoogleTarget | null; google_sync_enabled?: boolean | null }, googleConnected: boolean): boolean {
  const target = task.google_target ?? (task.google_sync_enabled ? 'tasks' : 'none')
  return googleConnected && (target === 'tasks' || target === 'both')
}
