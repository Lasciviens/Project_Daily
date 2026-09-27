// Progress engine — the per-pair comparability read: observedTransition,
// repDelta, rangeCompliance, evaluationScope, dataQualityFlags, and the
// derived currentAction. Four+ independent facets, never collapsed into one
// mutually-exclusive status, per the approved contract.

import type {
  CanonicalExerciseSession, ExpectationRange, ExerciseProgressionPolicy, ProgressMetricKind,
  ObservedTransition, RepDelta, RangeCompliance, EvaluationScope, DataQualityFlag, CurrentAction,
} from './types'
import { bestComparableSet } from './normalize'
import { isPositiveLoadChange } from './policies'
import { meaningfulDeclineReps } from './trend'
import {
  isWeightBasedMetric, isCleanProgression, totalQuantity, metricValueOf,
  complianceFromReps, evaluableRepresentativeSet,
} from './metricStrategy'

export interface ComparabilityResult {
  observedTransition: ObservedTransition
  repDelta: RepDelta
  rangeCompliance: RangeCompliance
  evaluationScope: EvaluationScope
  dataQualityFlags: DataQualityFlag[]
  currentAction: CurrentAction
  progressDirection: boolean | null
  loadChangePercent: number | null
}

export function evaluatePair(
  previous: CanonicalExerciseSession,
  latest: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: ProgressMetricKind,
  policy: ExerciseProgressionPolicy,
): ComparabilityResult {
  const dataQualityFlags: DataQualityFlag[] = []
  const prevWorking = previous.comparableWorkingSets
  const latestWorking = latest.comparableWorkingSets

  if (latestWorking.length < expectation.targetSets) dataQualityFlags.push('MISSING_PRESCRIBED_SET')
  if (latestWorking.length > expectation.targetSets) dataQualityFlags.push('EXTRA_UNPRESCRIBED_SET')
  // PROGRAM_CHANGED is deliberately NEVER emitted in v1 — see
  // docs/training/progress-engine/DATA_AND_LIMITATIONS.md. A set-count
  // mismatch only ever proves MISSING/EXTRA above, never a target change.
  if (latest.loadStructure === 'mixed_load') dataQualityFlags.push('MIXED_LOAD_SESSION')

  const prevBest = bestComparableSet(previous, metricKind)
  const latestBest = bestComparableSet(latest, metricKind)
  const weightBased = isWeightBasedMetric(metricKind)
  // The value actually compared for direction/transition: raw weight for a
  // weight-based metric (est1rm/addedWeight/assistedWeight), the metric's
  // own value for a kind with no weight axis (reps/duration/distance).
  const prevPrimary = weightBased ? (prevBest?.weightKg ?? null) : metricValueOf(prevBest, metricKind)
  const latestPrimary = weightBased ? (latestBest?.weightKg ?? null) : metricValueOf(latestBest, metricKind)

  let observedTransition: ObservedTransition = 'NO_COMPARISON'
  if (prevPrimary != null && latestPrimary != null) {
    observedTransition = prevPrimary === latestPrimary ? 'LOAD_UNCHANGED'
      : (isPositiveLoadChange(metricKind, prevPrimary, latestPrimary) ? 'LOAD_INCREASED' : 'LOAD_DECREASED')
  }
  const progressDirection = isPositiveLoadChange(metricKind, prevPrimary, latestPrimary)
  const loadChangePercent = (prevPrimary != null && latestPrimary != null && prevPrimary !== 0)
    ? Math.round((latestPrimary / prevPrimary - 1) * 1000) / 10 : null

  const setCountMismatch = prevWorking.length !== latestWorking.length
  let repDelta: RepDelta = 'NOT_APPLICABLE'
  if (observedTransition === 'LOAD_UNCHANGED' && !setCountMismatch && latest.loadStructure !== 'mixed_load') {
    if (isCleanProgression(prevWorking, latestWorking, metricKind)) repDelta = 'REP_INCREASE'
    else {
      const prevTotal = totalQuantity(prevWorking, metricKind)
      const latestTotal = totalQuantity(latestWorking, metricKind)
      if (prevTotal == null || latestTotal == null) {
        repDelta = 'NOT_APPLICABLE'
      } else {
        // The total's quantity axis (reps/duration/distance) is always
        // "more is better", never inverted by metric kind — see
        // isCleanProgression's own note in metricStrategy.ts.
        const declinedBy = prevTotal - latestTotal
        repDelta = declinedBy >= meaningfulDeclineReps(Math.abs(prevTotal), policy) ? 'REP_DECLINE' : 'REP_NO_CHANGE'
      }
    }
  }

  // ALL_PRESCRIBED_WORKING_SETS requires the latest session's comparable
  // set count to match the target's prescribed count EXACTLY — a mismatch
  // (missing or extra) always narrows the scope, never claims full
  // compliance regardless of how many sets happened to be logged.
  const matchesPrescribedCount = latestWorking.length === expectation.targetSets

  let evaluationScope: EvaluationScope
  let rangeCompliance: RangeCompliance
  if (latest.loadStructure === 'mixed_load' || latestBest == null) {
    // `latestBest == null` covers every other reason the metric simply
    // isn't evaluable for this session — most notably a weight_duration-
    // style composite session, which classifies as a perfectly ordinary
    // uniform_working_load/top_set_and_backoff structure (its sets DO
    // share one clean weight shape) while every set is individually
    // ineligible for the duration/distance metric (metricStrategy.ts's
    // composite exclusion). Without this check, a set-count match alone
    // was enough to claim ALL_PRESCRIBED_WORKING_SETS and run
    // complianceFromReps off `s.reps` — a field this metric never actually
    // evaluated — which could fabricate a real compliance read (or a
    // false NOT_EVALUATED for the wrong reason) instead of honestly
    // reporting "nothing here was evaluable at all".
    evaluationScope = 'NOT_EVALUATED'
    rangeCompliance = 'NOT_EVALUATED'
  } else if (latest.loadStructure === 'top_set_and_backoff') {
    evaluationScope = 'TOP_SET_ONLY'
    const reps = latestBest ? [latestBest.reps] : []
    rangeCompliance = complianceFromReps(reps, expectation)
  } else if (matchesPrescribedCount) {
    evaluationScope = 'ALL_PRESCRIBED_WORKING_SETS'
    rangeCompliance = complianceFromReps(latestWorking.map(s => s.reps), expectation)
  } else {
    evaluationScope = 'LOGGED_SETS_ONLY'
    rangeCompliance = complianceFromReps(latestWorking.map(s => s.reps), expectation)
  }

  // A complete top-set+backoff session whose backoff sets all clear the
  // minimum has had EVERY prescribed set checked — the top set against the
  // range, each backoff against its floor — so a top set at the top of the
  // range may earn READY_TO_INCREASE (the top set's load goes up). Without
  // this, a top-set scheme could never be told to add load at all.
  const backoffsClearMinimum = latest.loadStructure === 'top_set_and_backoff'
    && matchesPrescribedCount
    && [...latestWorking].sort((a, b) => a.order - b.order).slice(1)
      .every(s => s.reps != null && (expectation.repMin == null || s.reps >= expectation.repMin))

  const currentAction = deriveCurrentAction({
    evaluationScope, rangeCompliance, observedTransition, repDelta, progressDirection,
    compromised: dataQualityFlags.length > 0, backoffsClearMinimum,
  })

  return { observedTransition, repDelta, rangeCompliance, evaluationScope, dataQualityFlags, currentAction, progressDirection, loadChangePercent }
}

/** A single session's own range compliance (never a pair) — the building
 *  block for `requiredTopRangeConfirmations`: counting how many CONSECUTIVE
 *  trailing sessions independently land ALL_SETS_AT_TOP before READY_TO_
 *  INCREASE is allowed to stand, rather than firing off a single session's
 *  read. Mirrors evaluatePair's own per-session scope/compliance logic
 *  exactly, just without the pair-comparison half.
 *
 *  Delegates the structural evaluability check (mixed_load / no
 *  representative set / set-count mismatch) to `evaluableRepresentativeSet`
 *  in metricStrategy.ts — the SAME gate `isQualifiedForPositiveSignal` uses
 *  — applied identically regardless of load shape (§1): the exact-count
 *  check used to run only for a plain uniform_working_load session, so a
 *  top_set_and_backoff session missing a backoff set (e.g. 2 of a 3-set
 *  target) could still read ALL_SETS_AT_TOP off its own top set alone. */
export function sessionRangeCompliance(
  session: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: ProgressMetricKind,
): RangeCompliance {
  const point = { loadStructure: session.loadStructure, sets: session.comparableWorkingSets }
  const rep = evaluableRepresentativeSet(point, expectation, metricKind)
  if (rep == null) return 'NOT_EVALUATED'
  const reps = session.loadStructure === 'top_set_and_backoff' ? [rep.reps] : session.comparableWorkingSets.map(s => s.reps)
  return complianceFromReps(reps, expectation)
}

function deriveCurrentAction(input: {
  evaluationScope: EvaluationScope; rangeCompliance: RangeCompliance; observedTransition: ObservedTransition
  repDelta: RepDelta; progressDirection: boolean | null; compromised: boolean; backoffsClearMinimum: boolean
}): CurrentAction {
  const { evaluationScope, rangeCompliance, observedTransition, repDelta, progressDirection, compromised, backoffsClearMinimum } = input

  // Nothing comparable this session (mixed loads, or nothing the metric can
  // read) — ask for a comparable session instead of pretending it held steady.
  if (evaluationScope === 'NOT_EVALUATED') return 'LOG_COMPARABLE_SESSION'

  // observedTransition is already direction-aware: LOAD_DECREASED means the
  // metric moved the easy way — a lighter weight, or MORE assistance on an
  // assisted exercise. Intent is unknown either way, so it's never labelled a
  // deload (§8). (A drop in assistance reads LOAD_INCREASED and is handled as
  // forward motion below.)
  if (observedTransition === 'LOAD_DECREASED') return 'REVIEW_LOAD_REDUCTION'

  // §2: READY_TO_INCREASE requires every prescribed set to have been checked:
  // a full uniform session at the top of the range, or a complete top-set +
  // backoff session whose top set is at the top and whose backoff sets all
  // clear the minimum. A top set alone, with backoff work missing or short,
  // is never enough.
  const readyEligible = rangeCompliance === 'ALL_SETS_AT_TOP'
    && (evaluationScope === 'ALL_PRESCRIBED_WORKING_SETS' || (evaluationScope === 'TOP_SET_ONLY' && backoffsClearMinimum))

  const isForwardMotion = progressDirection === true || (observedTransition === 'LOAD_UNCHANGED' && repDelta === 'REP_INCREASE')
  if (isForwardMotion) {
    if (readyEligible) return compromised ? 'CONFIRM_AT_CURRENT_LOAD' : 'READY_TO_INCREASE'
    if (rangeCompliance === 'BELOW_MINIMUM') return 'CONFIRM_BEFORE_INCREASING'
    return compromised ? 'CONFIRM_AT_CURRENT_LOAD' : 'BUILD_AT_CURRENT_LOAD'
  }
  if (readyEligible) return compromised ? 'CONFIRM_AT_CURRENT_LOAD' : 'READY_TO_INCREASE'
  // Evaluated, but no forward motion: the same numbers, a small dip, or a
  // set count that didn't line up. The target layer turns this into a
  // concrete "repeat it and add a rep" (or "get back to last time") plan.
  return 'HOLD_STEADY'
}
