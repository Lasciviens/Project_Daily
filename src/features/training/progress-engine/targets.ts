// Progress engine — Next Target generation. Carries a per-position floor,
// not just a total (§4): a candidate like 8/6/8 must fail against a floor
// of [8,7,6] even though its total (22) matches, because position 2
// regressed. `minimumSetReps` IS the real constraint; `minimumTotalReps`
// is a convenience number derived from it, never the sole check.

import type { CanonicalExerciseSession, ExpectationRange, NextTargetResult } from './types'
import { bestComparableSet } from './normalize'

export function buildNextTargets(
  latest: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: string,
): NextTargetResult | null {
  const sets = latest.comparableWorkingSets
  if (sets.length === 0) return null
  const reps = sets.map(s => s.reps ?? 0)
  const minimumSetReps = reps.slice()
  const minimumTotalReps = reps.reduce((a, b) => a + b, 0) + 1
  const load = bestComparableSet(latest, metricKind)?.weightKg ?? null
  const loadLabel = load != null ? `${load} kg` : 'this load'

  return {
    nextSession: {
      headline: `Stay at ${loadLabel}. Match or beat ${minimumSetReps.join('/')} on every set, and reach at least ${minimumTotalReps} total reps.`,
      loadKg: load, targetSets: sets.length, minimumTotalReps, minimumSetReps,
      explanationCode: 'BUILD_NEXT_SESSION',
    },
    progressionRequirement: {
      headline: expectation.repMax != null
        ? `Increase only after ${loadLabel} reaches ${Array(sets.length).fill(expectation.repMax).join('/')}.`
        : `Increase once every set clears your target range at ${loadLabel}.`,
      loadKg: load,
      targetSetReps: expectation.repMax != null ? Array(sets.length).fill(expectation.repMax) : null,
      explanationCode: 'PROGRESSION_REQUIREMENT_TOP_OF_RANGE',
    },
  }
}

/** Checks a hypothetical next-session set vector against a NextTargetResult's
 *  floor — every position must meet or beat `minimumSetReps` AND the total
 *  must meet `minimumTotalReps`. Exported for the verification suite; the
 *  production UI never needs to call this itself (it only ever displays the
 *  target, real evaluation happens on the NEXT session once logged). */
export function meetsNextTargetFloor(candidate: readonly number[], target: NextTargetResult['nextSession']): boolean {
  if (!target.minimumSetReps || target.minimumTotalReps == null) return false
  if (candidate.length !== target.minimumSetReps.length) return false
  const perSetOk = candidate.every((r, i) => r >= (target.minimumSetReps as readonly number[])[i])
  const totalOk = candidate.reduce((a, b) => a + b, 0) >= target.minimumTotalReps
  return perSetOk && totalOk
}
