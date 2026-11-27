// Training skips (training_skips, migrations 112/142) and their reasons — pure (scripts/verify-skipped-routines.cjs).
// The rhythm-based "Missed sessions" (a routine not trained for 7+ days, warn colours, ignoring the plan) is retired
// (213; owner, 27.11.2026: "MISSED SESSIONS … this is not working as it should"): the screens and the coach read the
// plan's week instead (sessionState.planWeek, plan/weekInputs). What stays: a skip's reason and which skip covers a
// planned session.

export const SKIP_REASON_MIN = 3
export const SKIP_REASON_MAX = 500
export const SKIP_REASON_CHIPS = ['Sick', 'Travel', 'Rest / fatigue', 'Injury', 'Busy'] as const

export interface SkipRecord {
  id: string
  /** null for a skipped plan with no routine ("Training", migration 142). */
  routine_id: string | null
  /** Monday (yyyy-MM-dd) of the week the missed session was due. */
  week_start: string
  reason: string
  /** The planned session (task) this skip cancelled (migration 142). */
  task_id?: string | null
  /** The day that session was planned for (142). */
  plan_date?: string | null
}

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

/** How far back skips are read: the rule only needs last week's; the coach
 *  context and the audit trail are served by a few more. */
export const SKIP_LOOKBACK_WEEKS = 8

export function skipsFromWeek(today: string): string {
  return shiftDay(weekStartOf(today), -7 * SKIP_LOOKBACK_WEEKS)
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

/** The routine-week skip (Missed sessions: no task) that covers `routineId`
 *  on `date` — it covers the week its missed session was due in. A skip with
 *  a task is that one session's own and covers nothing else (28.10.2026). */
export function skipCovering(skips: readonly SkipRecord[], routineId: string | null | undefined, date: string): SkipRecord | null {
  if (!routineId) return null
  const week = weekStartOf(date)
  return skips.find(s => !s.task_id && s.routine_id === routineId && s.week_start === week) ?? null
}

/** "Skipped: Busy — Got busy and tired." — the reason exactly as written. */
export function skippedText(skip: Pick<SkipRecord, 'reason'>): string {
  return `Skipped: ${skip.reason.trim()}`
}

/** The skip that covers one planned session (sessionState's skipReason):
 *  its task's own skip (142); for a cancelled task with none, or a plan with
 *  no task, the routine's skip for that week. A routine-week skip is written
 *  for a missed session, always a day before the day it is written: it never
 *  covers a plan with no task on today or later (a weekly day whose task 156
 *  makes on its day) — that one is still to do. */
export function skipForPlan(
  skips: readonly SkipRecord[],
  plan: { taskId?: string | null; taskCancelled?: boolean; routineId?: string | null; date: string; today: string },
): SkipRecord | null {
  if (plan.taskId) {
    const own = skips.find(s => s.task_id === plan.taskId)
    if (own) return own
    if (!plan.taskCancelled) return null
  } else if (plan.date >= plan.today) return null
  return skipCovering(skips, plan.routineId, plan.date)
}
