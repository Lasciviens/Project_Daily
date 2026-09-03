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
import { isWeightBasedMetric, isCleanProgression, totalQuantity, metricValueOf } from './metricStrategy'

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

  const currentAction = deriveCurrentAction({
    evaluationScope, rangeCompliance, observedTransition, repDelta, progressDirection, metricKind,
    compromised: dataQualityFlags.length > 0,
  })

  return { observedTransition, repDelta, rangeCompliance, evaluationScope, dataQualityFlags, currentAction, progressDirection, loadChangePercent }
}

/** A single session's own range compliance (never a pair) — the building
 *  block for `requiredTopRangeConfirmations`: counting how many CONSECUTIVE
 *  trailing sessions independently land ALL_SETS_AT_TOP before READY_TO_
 *  INCREASE is allowed to stand, rather than firing off a single session's
 *  read. Mirrors evaluatePair's own per-session scope/compliance logic
 *  exactly, just without the pair-comparison half. */
export function sessionRangeCompliance(
  session: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: ProgressMetricKind,
): RangeCompliance {
  if (session.loadStructure === 'mixed_load') return 'NOT_EVALUATED'
  // No representative set at all for this metric (e.g. a weight_duration
  // composite session, which shares one clean weight shape and so is
  // never classified mixed_load, but is individually ineligible on every
  // set) — nothing here was evaluated, never a fabricated compliance read.
  if (bestComparableSet(session, metricKind) == null) return 'NOT_EVALUATED'
  if (session.loadStructure === 'top_set_and_backoff') {
    const top = bestComparableSet(session, metricKind)
    return complianceFromReps(top ? [top.reps] : [], expectation)
  }
  // Requires the EXACT prescribed set count before this session can ever
  // read ALL_SETS_AT_TOP — a session logging FEWER sets than prescribed
  // (e.g. 2 of a 3-set target) must never count as a confirmed top-of-
  // range session for `requiredTopRangeConfirmations` purely because the
  // sets it did log happened to land at the top; that's an incomplete
  // session, not a confirmation.
  if (session.comparableWorkingSets.length !== expectation.targetSets) return 'NOT_EVALUATED'
  return complianceFromReps(session.comparableWorkingSets.map(s => s.reps), expectation)
}

function complianceFromReps(reps: readonly (number | null)[], expectation: ExpectationRange): RangeCompliance {
  if (reps.length === 0 || reps.some(r => r == null)) return 'NOT_EVALUATED'
  const values = reps as number[]
  if (expectation.repMax != null && values.every(r => r >= (expectation.repMax as number))) return 'ALL_SETS_AT_TOP'
  if (expectation.repMin != null && values.every(r => r >= (expectation.repMin as number))) return 'ALL_SETS_AT_OR_ABOVE_MIN'
  if (expectation.repMin == null && expectation.repMax == null) return 'NOT_EVALUATED'
  return 'BELOW_MINIMUM'
}

function deriveCurrentAction(input: {
  evaluationScope: EvaluationScope; rangeCompliance: RangeCompliance; observedTransition: ObservedTransition
  repDelta: RepDelta; progressDirection: boolean | null; metricKind: ProgressMetricKind; compromised: boolean
}): CurrentAction {
  const { evaluationScope, rangeCompliance, observedTransition, repDelta, progressDirection, metricKind, compromised } = input

  if (evaluationScope === 'NOT_EVALUATED') return 'HOLD_STEADY'

  // A raw load decrease has unknown intent — external-load types never get
  // "deload" language auto-generated (§8). Assisted-weight is the one
  // metric kind where a raw decrease IS the positive direction, handled by
  // the progressDirection branch below instead.
  if (observedTransition === 'LOAD_DECREASED' && metricKind !== 'assistedWeight') return 'REVIEW_LOAD_REDUCTION'

  const isForwardMotion = progressDirection === true || (observedTransition === 'LOAD_UNCHANGED' && repDelta === 'REP_INCREASE')
  if (isForwardMotion) {
    if (rangeCompliance === 'ALL_SETS_AT_TOP') return compromised ? 'CONFIRM_AT_CURRENT_LOAD' : 'READY_TO_INCREASE'
    if (rangeCompliance === 'BELOW_MINIMUM') return 'CONFIRM_BEFORE_INCREASING'
    return compromised ? 'CONFIRM_AT_CURRENT_LOAD' : 'BUILD_AT_CURRENT_LOAD'
  }
  if (rangeCompliance === 'ALL_SETS_AT_TOP') return compromised ? 'CONFIRM_AT_CURRENT_LOAD' : 'READY_TO_INCREASE'
  return 'HOLD_STEADY'
}
