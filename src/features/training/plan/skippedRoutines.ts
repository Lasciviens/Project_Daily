// Missed current-program sessions — pure and import-free apart from the (also
// pure) plan helpers in nextSession.ts (scripts/verify-skipped-routines.cjs).
//
// A current-program routine needs attention when it hasn't been logged for
// more than OVERDUE_AFTER_DAYS days. The athlete then either plans it on a
// day that works (a one-off training block dated today or later) or skips it
// with a reason (training_skips, migration 112).
//
// The "missed session" is anchored to the routine's own rhythm: it was due
// 7 days after the last time it was done (then every 7 days after that), and
// a skip covers the week that due day falls in. So a Friday routine missed on
// Friday is flagged on Saturday, and skipping it on Sunday keeps it quiet
// until the NEXT Friday passes — keyed by the calendar week of the skip
// instead, it came back on Monday for a session already skipped.
//
// Recurring training templates deliberately do NOT count as "planned": a
// weekly Friday template always has a next Friday, so it would silence the
// flag forever — and the missed Friday is exactly what this is about.

import { daysBetween, matchRoutineToPlan, type PlannedRef, type RoutineRef } from './nextSession'

/** Flag a routine once it is MORE than this many days since it was done
 *  (a weekly routine done last Monday is not flagged on Monday). */
export const OVERDUE_AFTER_DAYS = 7
export const SKIP_REASON_MIN = 3
export const SKIP_REASON_MAX = 500
export const SKIP_REASON_CHIPS = ['Sick', 'Travel', 'Rest / fatigue', 'Injury', 'Busy'] as const

export interface SkipRecord {
  id: string
  routine_id: string
  /** Monday (yyyy-MM-dd) of the week the missed session was due. */
  week_start: string
  reason: string
}

export interface ProgramRoutineRef extends RoutineRef {
  /** Local day the routine joined the current program; a routine added less
   *  than a week ago and never done since isn't "missed" yet. */
  joinedOn?: string | null
}

interface AttentionBase {
  routineId: string
  title: string
  /** Last local day it was done (within the training history window), null = not in it. */
  lastTrained: string | null
  daysSince: number | null
  /** The day the missed session was due. */
  dueDate: string
  /** Monday of dueDate's week — the key a skip is stored under. */
  weekStart: string
}

export type RoutineAttention =
  | (AttentionBase & { kind: 'overdue' })
  | (AttentionBase & { kind: 'skipped'; skip: SkipRecord })
  | (AttentionBase & { kind: 'replanned'; plannedDate: string })

/** yyyy-MM-dd shifted by n local days (noon keeps DST shifts off the date). */
export function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday of the local week `date` falls in. */
export function weekStartOf(date: string): string {
  const back = (new Date(`${date}T12:00:00`).getDay() + 6) % 7
  return shiftDay(date, -back)
}

/** The most recent due day before today in the 7-day rhythm that started at
 *  `anchor` (anchor + 7, + 14, …), or null when none has passed yet. */
export function missedSlot(anchor: string, today: string): string | null {
  const days = daysBetween(anchor, today)
  if (days <= OVERDUE_AFTER_DAYS) return null
  const k = Math.floor((days - 1) / OVERDUE_AFTER_DAYS)
  return shiftDay(anchor, k * OVERDUE_AFTER_DAYS)
}

const later = (a: string | null | undefined, b: string | null | undefined): string | null =>
  (a && b ? (a > b ? a : b) : a || b || null)

/**
 * One entry per current-program routine that needs a word, in this order:
 * overdue (longest gap first, never-done first), skipped, replanned; ties
 * keep program order. A routine done within the last 7 days, or not missed
 * yet, has no entry.
 *
 * - `routines`: every known routine, so a planned block is matched to the
 *   right one (defaults to the program).
 * - `upcoming`: ONE-OFF training blocks; anything dated before today is
 *   ignored (a plan in the past didn't happen).
 */
export function readMissedSessions(input: {
  program: readonly ProgramRoutineRef[]
  routines?: readonly RoutineRef[]
  lastTrained: ReadonlyMap<string, string>
  upcoming: readonly PlannedRef[]
  skips: readonly SkipRecord[]
  today: string
}): RoutineAttention[] {
  const { program, lastTrained, skips, today } = input
  const routines = input.routines ?? program
  const programIds = new Set(program.map(r => r.id))

  const plannedOn = new Map<string, string>()
  for (const p of input.upcoming) {
    if (p.date < today) continue
    const match = matchRoutineToPlan(p, routines, programIds)
    if (!match || !programIds.has(match.id)) continue
    const prev = plannedOn.get(match.id)
    if (!prev || p.date < prev) plannedOn.set(match.id, p.date)
  }

  const out: Array<{ a: RoutineAttention; order: number }> = []
  program.forEach((r, order) => {
    const last = lastTrained.get(r.id) ?? null
    const daysSince = last ? daysBetween(last, today) : null
    const anchor = later(last, r.joinedOn)
    // No anchor at all (never done, join day unknown): treat yesterday as the
    // due day, so a skip still has a week to cover.
    const dueDate = anchor ? missedSlot(anchor, today) : shiftDay(today, -1)
    if (!dueDate) return
    const weekStart = weekStartOf(dueDate)
    const base: AttentionBase = { routineId: r.id, title: r.title, lastTrained: last, daysSince, dueDate, weekStart }
    const planned = plannedOn.get(r.id)
    const skip = skips.find(s => s.routine_id === r.id && s.week_start === weekStart)
    const a: RoutineAttention = planned ? { ...base, kind: 'replanned', plannedDate: planned }
      : skip ? { ...base, kind: 'skipped', skip }
      : { ...base, kind: 'overdue' }
    out.push({ a, order })
  })

  const rank = { overdue: 0, skipped: 1, replanned: 2 } as const
  return out
    .sort((x, y) => {
      if (x.a.kind !== y.a.kind) return rank[x.a.kind] - rank[y.a.kind]
      if (x.a.kind === 'overdue') {
        const dx = x.a.daysSince ?? Infinity
        const dy = y.a.daysSince ?? Infinity
        if (dx !== dy) return dy - dx
      }
      return x.order - y.order
    })
    .map(x => x.a)
}

/** "Sick" + "flu since Thursday" → "Sick — flu since Thursday"; either part alone is fine. */
export function composeSkipReason(chip: string | null, details: string): string {
  const d = details.trim()
  const c = chip?.trim() ?? ''
  return c && d ? `${c} — ${d}` : c || d
}

export function isValidSkipReason(reason: string): boolean {
  const t = reason.trim()
  return t.length >= SKIP_REASON_MIN && reason.length <= SKIP_REASON_MAX
}

/** "not done in 9 days" / "not done yet" — the row's headline fact. */
export function missedText(a: Pick<AttentionBase, 'daysSince'>): string {
  if (a.daysSince == null) return 'no session in the last 6 months'
  return `not done in ${a.daysSince} ${a.daysSince === 1 ? 'day' : 'days'}`
}
