// Progress engine — raw ProgressSetRow[] -> CanonicalExerciseSession[].
// Pure, import-free. Preserves the COMPLETE ordered set vector (never
// reduced to a single "best set" at this layer) and the session's load
// shape, per the approved contract.

import type { ProgressSetRow } from '../progressAggregate'
import type { CanonicalExerciseSession, CanonicalSet, SessionLoadStructure, ProgressMetricKind } from './types'
import { selectRepresentativeSet } from './metricStrategy'

/** A 2-set heavier-then-lighter session is ALWAYS a valid top-set/backoff
 *  shape by definition (there is only one possible "rest" value) —
 *  mixed_load genuinely needs >= 3 sets with real internal inconsistency
 *  (e.g. 100, 90, 95 — a real increase mid-session, not one clean backoff
 *  step) to fire. Verified against the isolated demo's own test fixtures. */
export function classifyLoadStructure(sets: readonly { order: number; weightKg: number | null }[]): SessionLoadStructure {
  const withLoad = sets.filter(s => s.weightKg != null)
  if (withLoad.length === 0) return 'uniform_working_load' // no-load exercise types — trivially uniform
  const distinct = new Set(withLoad.map(s => s.weightKg))
  if (distinct.size === 1) return 'uniform_working_load'
  const ordered = [...withLoad].sort((a, b) => a.order - b.order)
  const first = ordered[0].weightKg as number
  const restLoads = new Set(ordered.slice(1).map(s => s.weightKg))
  const isCleanBackoff = restLoads.size === 1 && ([...restLoads][0] as number) < first && ordered.every(s => (s.weightKg as number) <= first)
  return isCleanBackoff ? 'top_set_and_backoff' : 'mixed_load'
}

/** Groups an exercise's raw sets into one CanonicalExerciseSession per
 *  workout — the session identity is `workout_id`, never date alone (a
 *  workout is the real, stable, real-world session boundary). Warmups are
 *  excluded entirely; dropset/failure sets are preserved and tagged.
 *  `set_index`/`workout_title` are optional on ProgressSetRow (older
 *  callers may not fetch them) — falls back to array order / null title. */
export function buildCanonicalSessions(sets: readonly ProgressSetRow[], exerciseTemplateId: string): CanonicalExerciseSession[] {
  const bySession = new Map<string, ProgressSetRow[]>()
  for (const s of sets) {
    if (s.exercise_template_id !== exerciseTemplateId) continue
    if (s.set_type === 'warmup') continue
    const arr = bySession.get(s.workout_id)
    if (arr) arr.push(s)
    else bySession.set(s.workout_id, [s])
  }

  const out: CanonicalExerciseSession[] = []
  for (const [workoutId, rows] of bySession) {
    const ordered = [...rows].sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0))
    const allSets: CanonicalSet[] = ordered.map((r, i) => ({
      order: r.set_index ?? i + 1,
      kind: r.set_type === 'dropset' ? 'dropset' : r.set_type === 'failure' ? 'failure' : 'normal',
      weightKg: r.weight_kg, reps: r.reps,
      durationSeconds: r.duration_seconds, distanceMeters: r.distance_meters,
      // Carried for display only (the session cards, "Last time", the coach).
      ...(r.rpe != null ? { rpe: r.rpe } : {}),
    }))
    const comparableWorkingSets = allSets.filter(s => s.kind !== 'dropset')
    out.push({
      workoutId, date: rows[0].date,
      workoutTitle: rows[0].workout_title ?? null,
      routineId: rows[0].routine_id ?? null,
      exerciseTemplateId,
      allSets, comparableWorkingSets,
      loadStructure: classifyLoadStructure(comparableWorkingSets),
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.workoutId.localeCompare(b.workoutId))
}

/** The session's representative set for this metric — real metric-strategy
 *  dispatch (`metricStrategy.ts`), never a naive "most reps wins": est1rm
 *  respects the <=12-rep e1RM ceiling, assistedWeight picks the LOWEST
 *  assistance, duration/distance require their own real quantity, and a
 *  `top_set_and_backoff` session always uses the actual top-set role
 *  rather than whichever set scores highest. Returns null when the metric
 *  genuinely isn't evaluable for this session (no eligible set) — callers
 *  must treat that as NOT_EVALUATED, never as a comparison against zero. */
export function bestComparableSet(session: CanonicalExerciseSession, metricKind: ProgressMetricKind): CanonicalSet | null {
  return selectRepresentativeSet(session.comparableWorkingSets, session.loadStructure, metricKind)
}
