// The exercise list's groups (Results) and the date helpers the progress model and the filters share — pure
// (sucrase-verified in scripts/verify-progress-engine.cjs §22 and verify-training-results), so the components only
// render. The old decision table's five tabs (Recent changes · Add weight · Add reps · Check · All) and their
// "No change" pill went with the table on 27.11.2026: one list, grouped by the next step.

import { actionLabel } from '../progress-engine/copy'
import type { CurrentAction, ExerciseProgressResult, ProgressMetricKind } from '../progress-engine/types'

export const RECENT_DAYS = 14

export function daysAgo(today: string, days: number): string {
  const d = new Date(today + 'T00:00:00')
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Results: one list grouped by the next action (27.11.2026) ───────────────
// Every exercise is in exactly one group — the same engine decision as its pill — so the four counts add up to the
// list (NEVER_HIDES: no group drops an exercise).

export type NextActionGroup = 'add_weight' | 'almost' | 'add_reps' | 'check'

export const NEXT_ACTION_GROUPS: { id: NextActionGroup; label: string; tip: string }[] = [
  { id: 'add_weight', label: 'Add weight', tip: 'Add weight: every set at the top of the range 2 sessions in a row — the next step is ready.' },
  { id: 'almost', label: 'Almost', tip: 'Almost: ready by the reps, but the next step is over 10 % of the load — reps first, or jump.' },
  { id: 'add_reps', label: 'Add reps', tip: 'Add reps: keep the load. Matching last time is on track; one more rep anywhere is progress.' },
  { id: 'check', label: 'Check', tip: 'Check: a step back after a jump, a set below the minimum, no change in 3+ weeks, or sets that differ from the plan.' },
]

const CHECK: ReadonlySet<CurrentAction> = new Set<CurrentAction>([
  'STEP_BACK', 'WATCH_FOR_PLATEAU', 'WATCH_FOR_REGRESSION', 'CONFIRM_AT_CURRENT_LOAD', 'LOG_COMPARABLE_SESSION',
])

/** The group of one exercise: Add weight, Almost, Check (its pill says Check or Step back, or a set fell below the
 *  minimum outside a new weight), else Add reps (build, repeat, a new weight, lighter, a first session). */
export function nextActionGroup(d: Pick<ExerciseProgressResult, 'currentAction' | 'rangeCompliance'>): NextActionGroup {
  if (d.currentAction === 'READY_TO_INCREASE') return 'add_weight'
  if (d.currentAction === 'ALMOST_READY') return 'almost'
  if (CHECK.has(d.currentAction)) return 'check'
  if (d.rangeCompliance === 'BELOW_MINIMUM' && d.currentAction !== 'NEW_WEIGHT' && d.currentAction !== 'INSUFFICIENT_DATA') return 'check'
  return 'add_reps'
}

export function groupCounts(decisions: readonly Pick<ExerciseProgressResult, 'currentAction' | 'rangeCompliance'>[]): Record<NextActionGroup, number> {
  const out: Record<NextActionGroup, number> = { add_weight: 0, almost: 0, add_reps: 0, check: 0 }
  for (const d of decisions) out[nextActionGroup(d)]++
  return out
}

/** The group a list opens on: the first one with an exercise, in the control's order (Add weight first). */
export function firstGroup(counts: Record<NextActionGroup, number>): NextActionGroup {
  return NEXT_ACTION_GROUPS.find(g => counts[g.id] > 0)?.id ?? 'add_weight'
}

/** The routines in the order they come up next: the next session's, then the week's sessions still to do, then the
 *  rest of the week (they come round again next week), then any other current-program routine. */
export function routinesInNextOrder(
  week: { sessions: readonly { routineId: string | null; mark: string }[] } | null,
  programRoutineIds: readonly string[],
): string[] {
  const out: string[] = []
  const add = (id: string | null | undefined) => { if (id && !out.includes(id)) out.push(id) }
  const sessions = week?.sessions ?? []
  for (const s of sessions) if (s.mark === 'next') add(s.routineId)
  for (const s of sessions) if (s.mark === 'open') add(s.routineId)
  for (const s of sessions) add(s.routineId)
  for (const id of programRoutineIds) add(id)
  return out
}

/** Exercises sorted by the next session's order: by routine (routinesInNextOrder), then their place in it; one in no
 *  routine goes last, A–Z by title. */
export function sortByNextSession<T extends { exerciseTemplateId: string }>(
  list: readonly T[],
  routineOrder: readonly string[],
  routines: readonly { id: string; exercises?: readonly { exercise_template_id: string; index: number }[] }[],
  titleOf: (id: string) => string,
): T[] {
  const rank = new Map<string, number>()
  routineOrder.forEach((rid, r) => {
    const routine = routines.find(x => x.id === rid)
    for (const e of [...(routine?.exercises ?? [])].sort((a, b) => a.index - b.index)) {
      if (!rank.has(e.exercise_template_id)) rank.set(e.exercise_template_id, r * 1000 + e.index)
    }
  })
  const at = (id: string) => rank.get(id) ?? Number.POSITIVE_INFINITY
  return [...list].sort((a, b) => at(a.exerciseTemplateId) - at(b.exerciseTemplateId)
    || titleOf(a.exerciseTemplateId).localeCompare(titleOf(b.exerciseTemplateId)))
}

/** The row's pill in this list: none when it only repeats the open group's name (Add reps in Add reps), and a new
 *  weight reads "Just moved up" here — beside the group's "Add reps" its own name ("New weight") read as a second call. */
export function rowPill(action: CurrentAction, metricKind: ProgressMetricKind, groupLabel: string): string | null {
  if (action === 'NEW_WEIGHT') return 'Just moved up'
  const label = actionLabel(action, metricKind)
  return label === groupLabel ? null : label
}
