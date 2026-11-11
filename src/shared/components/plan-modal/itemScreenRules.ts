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

import { addDaysIso, dayNumber } from '../../../features/daily/recurrence'
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
export type ScreenField = 'title' | 'notes' | 'time' | 'place' | 'repeat' | 'calendar' | 'deadline' | 'list' | 'own'

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
 * app's own fields (priority, labels, area, category, the window) always stay in the app.
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
    case 'notes':
      if (calendar === 'apple' && ctx.appleNotes === false) return viaTasks
      return calendar ?? viaTasks
    default: return calendar ?? viaTasks
  }
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
 * Apple refused the item: it belongs in Apple Calendar (its area is there and it wants a calendar), yet its slot or
 * plan still has no Apple copy two minutes after its last change. The browser can't read the queue's error (service
 * role only), so this is read from the row itself; the save's own warning says why.
 */
export function appleRefused(row: { icloud_area?: string | null; updated_at?: string | null } | null | undefined, wantsApple: boolean, now: number): boolean {
  if (!row || !wantsApple || row.icloud_area) return false
  const changed = row.updated_at ? Date.parse(row.updated_at) : NaN
  return Number.isFinite(changed) && now - changed > APPLE_SEND_GRACE_MS
}
