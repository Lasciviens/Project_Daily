// The Log calendar's month grid — pure and import-free apart from type-only
// imports (scripts/verify-training-log.cjs). Monday-first weeks that include
// the neighbouring months' days (so every week row is whole and its total
// counts the full week), one mark per day, and the week totals.

import { SESSION_LABEL, type SessionState } from '../../plan/sessionState'

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export interface MonthCell {
  date: string
  dayOfMonth: number
  /** False for the leading / trailing days of the neighbouring months. */
  inMonth: boolean
}

export interface MonthWeek {
  /** Monday (yyyy-MM-dd). */
  weekStart: string
  cells: MonthCell[]
}

/** The weeks that show `month` (0-based) of `year`: 4–6 rows of 7 days. */
export function monthWeeks(year: number, month: number): MonthWeek[] {
  const first = new Date(year, month, 1, 12)
  const back = (first.getDay() + 6) % 7
  const cursor = new Date(year, month, 1 - back, 12)
  const weeks: MonthWeek[] = []
  do {
    const cells: MonthCell[] = []
    for (let i = 0; i < 7; i++) {
      cells.push({ date: ymd(cursor), dayOfMonth: cursor.getDate(), inMonth: cursor.getMonth() === month })
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push({ weekStart: cells[0].date, cells })
  } while (cursor.getMonth() === month && cursor.getFullYear() === year)
  return weeks
}

/** First and last day on the grid (the range every read covers). */
export function monthGridRange(weeks: readonly MonthWeek[]): { from: string; to: string } {
  const last = weeks[weeks.length - 1]
  return { from: weeks[0].cells[0].date, to: last.cells[last.cells.length - 1].date }
}

/** The month a day falls in, as { year, month (0-based) }. */
export function monthOf(date: string): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) - 1 }
}

export function shiftMonth(m: { year: number; month: number }, delta: number): { year: number; month: number } {
  const total = m.year * 12 + m.month + delta
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 }
}

export type DayMark = 'done' | 'today' | 'pending' | 'missed' | 'upcoming' | 'skipped'

export const DAY_MARK_LABEL: Record<DayMark, string> = {
  done:     'Trained',
  today:    'Planned today',
  pending:  SESSION_LABEL.pending,
  upcoming: 'Planned',
  missed:   'Missed plan',
  skipped:  SESSION_LABEL.skipped,
}

const MARK_OF: Record<SessionState, DayMark> = {
  done: 'done', now: 'today', today: 'today', pending: 'pending', missed: 'missed', upcoming: 'upcoming', skipped: 'skipped',
}

/**
 * ONE mark per day, strongest first: a logged workout (or a plan done) →
 * done; else a plan still open today → today; a past plan a late workout
 * still completes → pending; a past plan nothing covered → missed; a future
 * plan → upcoming; a day whose plans were all skipped → skipped (grey).
 */
export function dayMarkOf(day: { sessions: readonly unknown[]; openPlans: readonly { status: SessionState }[] }): DayMark | null {
  if (day.sessions.length > 0) return 'done'
  const marks = new Set(day.openPlans.map(o => MARK_OF[o.status]))
  for (const s of ['done', 'today', 'pending', 'missed', 'upcoming', 'skipped'] as const) if (marks.has(s)) return s
  return null
}

/** Logged workouts in one week row. */
export function weekSessionCount(days: readonly { sessions: readonly unknown[] }[]): number {
  return days.reduce((n, d) => n + d.sessions.length, 0)
}
