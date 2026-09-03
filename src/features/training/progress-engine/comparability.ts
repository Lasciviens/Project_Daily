// Progress engine — the per-pair comparability read: observedTransition,
// repDelta, rangeCompliance, evaluationScope, dataQualityFlags, and the
// derived currentAction. Four+ independent facets, never collapsed into one
// mutually-exclusive status, per the approved contract.

import type {
  CanonicalExerciseSession, ExpectationRange, ExerciseProgressionPolicy,
  ObservedTransition, RepDelta, RangeCompliance, EvaluationScope, DataQualityFlag, CurrentAction,
} from './types'
import { bestComparableSet, totalComparableReps } from './normalize'
import { isPositiveLoadChange } from './policies'
import { meaningfulDeclineReps } from './trend'

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

/** A clean rep increase requires the SAME comparable set count (a set-count
 *  mismatch never enters a raw-total comparison, per §3) and no individual
 *  set decreasing — ANY positive total counts, no magnitude floor (a
 *  separate, configurable threshold exists ONLY for decline detection). */
function isCleanRepIncrease(prevSets: readonly { reps: number | null }[], latestSets: readonly { reps: number | null }[]): boolean {
  if (prevSets.length !== latestSets.length) return false
  const totalUp = latestSets.reduce((a, s) => a + (s.reps ?? 0), 0) > prevSets.reduce((a, s) => a + (s.reps ?? 0), 0)
  const noneDropped = latestSets.every((s, i) => (s.reps ?? 0) >= (prevSets[i].reps ?? 0))
  return totalUp && noneDropped
}

export function evaluatePair(
  previous: CanonicalExerciseSession,
  latest: CanonicalExerciseSession,
  expectation: ExpectationRange,
  metricKind: string,
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
  const prevLoad = prevBest?.weightKg ?? null
  const latestLoad = latestBest?.weightKg ?? null

  let observedTransition: ObservedTransition = 'NO_COMPARISON'
  if (prevLoad != null && latestLoad != null) {
    observedTransition = latestLoad === prevLoad ? 'LOAD_UNCHANGED' : (latestLoad > prevLoad ? 'LOAD_INCREASED' : 'LOAD_DECREASED')
  }
  const progressDirection = isPositiveLoadChange(metricKind as never, prevLoad, latestLoad)
  const loadChangePercent = (prevLoad != null && latestLoad != null && prevLoad !== 0)
    ? Math.round((latestLoad / prevLoad - 1) * 1000) / 10 : null

  const setCountMismatch = prevWorking.length !== latestWorking.length
  let repDelta: RepDelta = 'NOT_APPLICABLE'
  if (observedTransition === 'LOAD_UNCHANGED' && !setCountMismatch && latest.loadStructure !== 'mixed_load') {
    if (isCleanRepIncrease(prevWorking, latestWorking)) repDelta = 'REP_INCREASE'
    else {
      const prevTotal = totalComparableReps(previous) ?? 0
      const latestTotal = totalComparableReps(latest) ?? 0
      const drop = prevTotal - latestTotal
      repDelta = drop >= meaningfulDeclineReps(prevTotal, policy) ? 'REP_DECLINE' : 'REP_NO_CHANGE'
    }
  }

  let evaluationScope: EvaluationScope
  let rangeCompliance: RangeCompliance
  if (latest.loadStructure === 'mixed_load') {
    evaluationScope = 'NOT_EVALUATED'
    rangeCompliance = 'NOT_EVALUATED'
  } else {
    evaluationScope = setCountMismatch ? 'LOGGED_SETS_ONLY'
      : (latest.loadStructure === 'top_set_and_backoff' ? 'TOP_SET_ONLY' : 'ALL_PRESCRIBED_WORKING_SETS')
    const evalSets = latest.loadStructure === 'top_set_and_backoff' && latestBest ? [latestBest] : latestWorking
    const reps = evalSets.map(s => s.reps ?? 0)
    if (expectation.repMax != null && reps.length > 0 && reps.every(r => r >= (expectation.repMax as number))) rangeCompliance = 'ALL_SETS_AT_TOP'
    else if (expectation.repMin != null && reps.length > 0 && reps.every(r => r >= (expectation.repMin as number))) rangeCompliance = 'ALL_SETS_AT_OR_ABOVE_MIN'
    else if (reps.length === 0) rangeCompliance = 'NOT_EVALUATED'
    else rangeCompliance = 'BELOW_MINIMUM'
  }

  const currentAction = deriveCurrentAction({
    evaluationScope, rangeCompliance, observedTransition, repDelta, progressDirection, metricKind,
    compromised: dataQualityFlags.length > 0,
  })

  return { observedTransition, repDelta, rangeCompliance, evaluationScope, dataQualityFlags, currentAction, progressDirection, loadChangePercent }
}

function deriveCurrentAction(input: {
  evaluationScope: EvaluationScope; rangeCompliance: RangeCompliance; observedTransition: ObservedTransition
  repDelta: RepDelta; progressDirection: boolean | null; metricKind: string; compromised: boolean
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
