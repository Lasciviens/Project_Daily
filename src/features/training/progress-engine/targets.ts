// Progress engine — Next Target generation. Action-aware (§6): the target
// shown depends on the resolved currentAction, never a single generic
// "stay at this load" copy regardless of state.
//
// - READY_TO_INCREASE resolves a real next-load number via the approved
//   increment ladder (resolveLoadIncrementKg: an explicit per-exercise
//   override when one exists > an equipment-class default > the smallest
//   positive increment ever observed in this exercise's own history > an
//   honest "no increment history yet" fallback — never a fabricated number).
// - BUILD_AT_CURRENT_LOAD (and the other "stay here" actions) keeps the
//   load and carries a per-position floor, not just a total (§4): a
//   candidate like 8/6/8 must fail against a floor of [8,7,6] even though
//   its total (22) matches, because position 2 regressed. `minimumSetReps`
//   IS the real constraint; `minimumTotalReps` is a convenience number
//   derived from it, never the sole check.
// - NOT_EVALUATED / mixed-load / incomplete-reps sessions, and any action
//   with no "stay or increase" numeric meaning (HOLD_STEADY, REVIEW_LOAD_
//   REDUCTION, WATCH_FOR_*, INSUFFICIENT_DATA), return null — no numeric
//   progression recommendation is issued; the copy layer explains why
//   instead of guessing at a number the data doesn't support.

import type { CanonicalExerciseSession, ExpectationRange, NextTargetResult, ProgressMetricKind, CurrentAction, ExerciseProgressionPolicy } from './types'
import { bestComparableSet } from './normalize'
import { isWeightBasedMetric } from './metricStrategy'
import { resolveLoadIncrementKg } from './policies'

function round1(n: number): number { return Math.round(n * 10) / 10 }

const STAY_AT_LOAD_ACTIONS: ReadonlySet<CurrentAction> = new Set([
  'BUILD_AT_CURRENT_LOAD', 'CONFIRM_AT_CURRENT_LOAD', 'CONFIRM_BEFORE_INCREASING',
])

export function buildNextTargets(
  latest: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: ProgressMetricKind,
  currentAction: CurrentAction,
  policy: ExerciseProgressionPolicy,
  equipmentClass: 'barbell' | 'dumbbell' | 'machine' | null,
  observedIncrements: readonly number[],
): NextTargetResult | null {
  const sets = latest.comparableWorkingSets
  if (sets.length === 0) return null
  // A mixed-load or incomplete-reps session carries no reliable per-position
  // floor to build from — issuing one would fabricate confidence the data
  // doesn't support (§6). Request one clean complete session instead; the
  // copy layer (ExerciseDecisionTable/copy.ts) surfaces that explanation.
  if (latest.loadStructure === 'mixed_load') return null
  const reps = sets.map(s => s.reps)
  if (reps.some(r => r == null)) return null
  const repsN = reps as number[]

  const load = bestComparableSet(latest, metricKind)?.weightKg ?? null
  const loadLabel = load != null ? `${load} kg` : 'this load'

  if (currentAction === 'READY_TO_INCREASE') {
    const increment = isWeightBasedMetric(metricKind) ? resolveLoadIncrementKg(equipmentClass, observedIncrements, policy) : null
    const nextLoad = load != null && increment != null
      ? round1(metricKind === 'assistedWeight' ? load - increment : load + increment)
      : null
    const nextLoadLabel = nextLoad != null ? `${nextLoad} kg` : 'the smallest available increment'
    return {
      nextSession: {
        headline: nextLoad != null
          ? `Ready to increase: try ${nextLoadLabel} (up from ${loadLabel}).`
          : `Ready to increase from ${loadLabel} — no increment history yet, so use ${nextLoadLabel}.`,
        loadKg: nextLoad, targetSets: sets.length, minimumTotalReps: null, minimumSetReps: null,
        explanationCode: 'READY_TO_INCREASE_NEXT_LOAD',
      },
      progressionRequirement: {
        headline: expectation.repMin != null
          ? `Land at or above ${expectation.repMin} reps on every set at ${nextLoadLabel} before increasing again.`
          : `Land inside your target range at ${nextLoadLabel} before increasing again.`,
        loadKg: nextLoad,
        targetSetReps: expectation.repMin != null ? Array(sets.length).fill(expectation.repMin) : null,
        explanationCode: 'PROGRESSION_REQUIREMENT_TOP_OF_RANGE',
      },
    }
  }

  if (!STAY_AT_LOAD_ACTIONS.has(currentAction)) {
    // HOLD_STEADY / REVIEW_LOAD_REDUCTION / WATCH_FOR_PLATEAU /
    // WATCH_FOR_REGRESSION / INSUFFICIENT_DATA — none of these carry a
    // "stay or increase" numeric meaning; no numeric target is issued.
    return null
  }

  const minimumSetReps = repsN.slice()
  const minimumTotalReps = repsN.reduce((a, b) => a + b, 0) + 1

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
