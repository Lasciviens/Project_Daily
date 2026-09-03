// Progress engine — the single pure orchestration entry point. Combines
// comparability.ts / trend.ts / events.ts / targets.ts into one structured
// ExerciseProgressResult. No React, no Supabase — sucrase-testable.

import type {
  CanonicalExerciseSession, ExpectationRange, ExerciseProgressionPolicy, ExerciseProgressResult,
  DecisionReason, SessionExposure, CurrentStateSummary, EvidenceLevel, ProgressMetricKind, CurrentAction,
} from './types'
import { ALGORITHM_VERSION } from './policies'
import { bestComparableSet } from './normalize'
import { buildRepresentativePoints, buildLoadCycles, computeRecentProgressTrend, computeCurrentLoadProgress, type LoadCycle } from './trend'
import { evaluatePair, sessionRangeCompliance } from './comparability'
import { detectProgressEvents, detectEstimatedStrengthPr } from './events'
import { buildNextTargets } from './targets'
import { selectRepresentativeSet, metricValueOf } from './metricStrategy'

function round1(n: number): number { return Math.round(n * 10) / 10 }

function toExposure(session: CanonicalExerciseSession, metricKind: ProgressMetricKind): SessionExposure {
  return {
    date: session.date, workoutId: session.workoutId, workoutTitle: session.workoutTitle,
    loadStructure: session.loadStructure,
    representativeWeightKg: bestComparableSet(session, metricKind)?.weightKg ?? null,
    sets: session.allSets,
  }
}

/** Selects the HIGHEST actual e1RM value logged this session — never
 *  "whichever set has the most reps" (a real bug: 60kg x8's e1RM (~76kg) is
 *  materially higher than 45kg x12's (~63kg), so a reps-based pick would
 *  silently report the wrong number as "current strength"). Bypasses the
 *  top-set-and-backoff role-lock via 'uniform_working_load' for the same
 *  reason `detectEstimatedStrengthPr` does in events.ts — this is about the
 *  best e1RM the session actually produced, not which set played the
 *  "top set" role. */
function bestE1RMForSession(s: CanonicalExerciseSession): number | null {
  const best = selectRepresentativeSet(s.comparableWorkingSets, 'uniform_working_load', 'est1rm')
  return metricValueOf(best, 'est1rm')
}

function buildCurrentState(previous: CanonicalExerciseSession, latest: CanonicalExerciseSession, metricKind: ProgressMetricKind, loadChangePercent: number | null): CurrentStateSummary {
  let estimatedStrengthChange: CurrentStateSummary['estimatedStrengthChange'] = null
  if (metricKind === 'est1rm') {
    const from = bestE1RMForSession(previous), to = bestE1RMForSession(latest)
    if (from != null && to != null && from > 0) {
      estimatedStrengthChange = { fromKg: round1(from), toKg: round1(to), percent: round1((to / from - 1) * 100) }
    }
  }
  return { previous: toExposure(previous, metricKind), latest: toExposure(latest, metricKind), loadChangePercent, estimatedStrengthChange }
}

/** How much history supports the RECENT trend read — sample size and time
 *  span, over the WINDOWED series specifically (§7). Both inputs must come
 *  from the same recent window `trend.recentProgressTrend` itself used
 *  (`recentWindowSessions` sessions, that window's own date span) — never
 *  the exercise's full all-time history, which could overstate confidence
 *  in a trend read that only ever looked at a handful of recent sessions
 *  (e.g. 50 sessions across 2 years reading "Strong" while the actual trend
 *  only used the last 8, spanning 6 weeks). */
function computeProgressEvidence(windowedSessionCount: number, windowedWeekSpan: number): EvidenceLevel {
  if (windowedSessionCount >= 6 && windowedWeekSpan >= 3) return 'strong'
  if (windowedSessionCount >= 4 && windowedWeekSpan >= 2) return 'moderate'
  return 'limited'
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000
}

/** The smallest positive load step ever observed between consecutive load
 *  cycles for THIS exercise — rung 3 of `resolveLoadIncrementKg`'s ladder.
 *  Direction-aware: for assistedWeight, a cycle-to-cycle DECREASE in
 *  assistance weight is the positive step being measured. */
function observedLoadIncrements(cycles: readonly LoadCycle[], metricKind: ProgressMetricKind): number[] {
  const weights = cycles.map(c => c.weightKg).filter((w): w is number => w != null)
  const diffs: number[] = []
  for (let i = 1; i < weights.length; i++) {
    const d = metricKind === 'assistedWeight' ? weights[i - 1] - weights[i] : weights[i] - weights[i - 1]
    if (d > 0) diffs.push(round1(d))
  }
  return diffs
}

/** How many CONSECUTIVE trailing sessions (ending at `latest`) independently
 *  land ALL_SETS_AT_TOP — the real gate behind `requiredTopRangeConfirmations`
 *  (§6): a single top-of-range session is not, by itself, enough to justify
 *  READY_TO_INCREASE once the policy asks for more than one confirmation. */
function countConsecutiveTopRangeSessions(
  sessions: readonly CanonicalExerciseSession[],
  expectation: ExpectationRange,
  metricKind: ProgressMetricKind,
): number {
  let count = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessionRangeCompliance(sessions[i], expectation, metricKind) !== 'ALL_SETS_AT_TOP') break
    count++
  }
  return count
}

export interface EvaluateExerciseProgressInput {
  exerciseTemplateId: string
  metricKind: ProgressMetricKind
  sessions: readonly CanonicalExerciseSession[] // already current-program-filtered, ascending by date
  expectation: ExpectationRange
  /** Equipment class for the load-increment ladder's rung 2 (an equipment-
   *  class default) — inferred from the exercise's own title by the caller
   *  (see useProgressData.ts's `inferEquipmentClass`); null when nothing
   *  recognizable was found, a fully honest fallback (the ladder just moves
   *  to rung 3/4 instead). */
  equipmentClass?: 'barbell' | 'dumbbell' | 'machine' | null
  /** Rung 1 of the load-increment ladder — an explicit, athlete-set
   *  per-exercise override. No UI writes this yet (see
   *  DATA_AND_LIMITATIONS.md); left undefined/null everywhere it's not
   *  wired, which correctly falls through to rung 2. */
  explicitIncrementKg?: number | null
}

export function evaluateExerciseProgress(input: EvaluateExerciseProgressInput, policy: ExerciseProgressionPolicy): ExerciseProgressResult {
  const { exerciseTemplateId, metricKind, sessions, expectation, equipmentClass = null, explicitIncrementKg = null } = input
  const comparableSessions = sessions.length
  const weekSpan = comparableSessions >= 2 ? Math.round(daysBetween(sessions[0].date, sessions[sessions.length - 1].date) / 7) : 0

  if (comparableSessions < 2) {
    return {
      algorithmVersion: ALGORITHM_VERSION, exerciseTemplateId, metricKind,
      observedTransition: 'NO_COMPARISON', repDelta: 'NOT_APPLICABLE', rangeCompliance: 'NOT_EVALUATED', evaluationScope: 'NOT_EVALUATED',
      dataQualityFlags: [], currentAction: 'INSUFFICIENT_DATA',
      trend: { recentProgressTrend: 'INSUFFICIENT_HISTORY', recentWindowSessions: comparableSessions, recentWindowWeekSpan: weekSpan, recentPositiveSignals: 0, recentNegativeSignals: 0, currentLoadProgress: 'INSUFFICIENT_HISTORY', currentLoadCycleSessions: 0, currentLoadSlope: null, currentLoadResidualSpread: null },
      evidence: { progress: 'limited', recommendation: null },
      reasons: [{ code: 'INSUFFICIENT_DATA', severity: 'info', values: { comparableSessions } }],
      events: [], currentState: { previous: null, latest: sessions[0] ? toExposure(sessions[0], metricKind) : null, loadChangePercent: null, estimatedStrengthChange: null },
      nextTargets: null, expectation, comparableSessions, weekSpan,
    }
  }

  const previous = sessions[sessions.length - 2]
  const latest = sessions[sessions.length - 1]
  const latestIndex = sessions.length - 1

  const pair = evaluatePair(previous, latest, expectation, metricKind, policy)
  const currentState = buildCurrentState(previous, latest, metricKind, pair.loadChangePercent)

  const points = buildRepresentativePoints(sessions, metricKind)
  const cycles = buildLoadCycles(points)
  const currentCycle = cycles[cycles.length - 1]
  const clp = computeCurrentLoadProgress(currentCycle.points, metricKind, policy)
  const recent = computeRecentProgressTrend(points, metricKind, policy)

  // The SAME windowed sessions computeRecentProgressTrend actually used
  // (recent.n, always <= policy.recentWindowSessions) — progress evidence
  // (§7) is confidence in THIS read specifically, so its own date span,
  // never the exercise's full all-time span, is what must back it.
  const recentWindowSessionsSlice = sessions.slice(-recent.n)
  const recentWindowWeekSpan = recentWindowSessionsSlice.length >= 2
    ? Math.round(daysBetween(recentWindowSessionsSlice[0].date, recentWindowSessionsSlice[recentWindowSessionsSlice.length - 1].date) / 7)
    : 0

  // Precedence: a real, fresh improvement this pair overrides a plateau/
  // regression read from the longer window — the two-point read wins only
  // when it shows genuine forward motion; the long-window read governs
  // otherwise.
  let currentAction: CurrentAction = pair.currentAction
  const freshImprovement = pair.observedTransition === 'LOAD_INCREASED' && pair.rangeCompliance !== 'BELOW_MINIMUM'
    || pair.repDelta === 'REP_INCREASE'
  if (!freshImprovement && pair.dataQualityFlags.length === 0) {
    if (clp.state === 'POSSIBLE_PLATEAU') currentAction = 'WATCH_FOR_PLATEAU'
    else if (clp.state === 'DECLINING') currentAction = 'WATCH_FOR_REGRESSION'
  }

  // requiredTopRangeConfirmations gate: READY_TO_INCREASE only stands once
  // at least N consecutive trailing sessions independently land at the top
  // of the range — a single session's read is downgraded back to
  // BUILD_AT_CURRENT_LOAD (still compliant, just not yet confirmed) rather
  // than recommending a load increase off one data point.
  let topRangeConfirmations: number | null = null
  if (currentAction === 'READY_TO_INCREASE' && policy.requiredTopRangeConfirmations > 1) {
    topRangeConfirmations = countConsecutiveTopRangeSessions(sessions, expectation, metricKind)
    if (topRangeConfirmations < policy.requiredTopRangeConfirmations) currentAction = 'BUILD_AT_CURRENT_LOAD'
  }

  const strengthPr = detectEstimatedStrengthPr(sessions, latestIndex, metricKind)
  const events = [
    ...detectProgressEvents(points, latestIndex, metricKind, latest, expectation, policy),
    ...(strengthPr ? [strengthPr] : []),
  ]

  const reasons: DecisionReason[] = []
  if (pair.observedTransition === 'LOAD_INCREASED' && pair.loadChangePercent != null) {
    reasons.push({ code: 'LOAD_INCREASED_PCT', severity: 'positive', values: { percent: pair.loadChangePercent } })
  }
  if (pair.rangeCompliance === 'ALL_SETS_AT_OR_ABOVE_MIN') {
    reasons.push({ code: 'ALL_SETS_ABOVE_MINIMUM', severity: 'positive', values: { repMin: expectation.repMin } })
    reasons.push({ code: 'TOP_OF_RANGE_NOT_REACHED', severity: 'info', values: { repMax: expectation.repMax } })
  }
  if (pair.rangeCompliance === 'BELOW_MINIMUM') reasons.push({ code: 'BELOW_TARGET_MINIMUM', severity: 'caution', values: { repMin: expectation.repMin } })
  if (pair.repDelta === 'REP_INCREASE') reasons.push({ code: 'REP_INCREASE_CLEAN', severity: 'positive', values: {} })
  if (currentAction === 'REVIEW_LOAD_REDUCTION') reasons.push({ code: 'LOAD_DECREASED_UNKNOWN_INTENT', severity: 'caution', values: { fromKg: bestComparableSet(previous, metricKind)?.weightKg ?? null, toKg: bestComparableSet(latest, metricKind)?.weightKg ?? null } })
  if (metricKind === 'assistedWeight' && pair.progressDirection === true) reasons.push({ code: 'ASSISTANCE_REDUCED', severity: 'positive', values: {} })
  if (currentAction === 'WATCH_FOR_PLATEAU' || currentAction === 'WATCH_FOR_REGRESSION') reasons.push({ code: 'NO_TREND_AT_CURRENT_LOAD', severity: 'caution', values: { sessionsAtLoad: clp.n } })
  if (topRangeConfirmations != null && currentAction === 'BUILD_AT_CURRENT_LOAD') {
    reasons.push({ code: 'AWAITING_TOP_RANGE_CONFIRMATION', severity: 'info', values: { confirmations: topRangeConfirmations, required: policy.requiredTopRangeConfirmations } })
  }
  for (const flag of pair.dataQualityFlags) {
    if (flag === 'MISSING_PRESCRIBED_SET') reasons.push({ code: 'DATA_QUALITY_MISSING_SET', severity: 'caution', values: {} })
    if (flag === 'EXTRA_UNPRESCRIBED_SET') reasons.push({ code: 'DATA_QUALITY_EXTRA_SET', severity: 'caution', values: {} })
    if (flag === 'MIXED_LOAD_SESSION') reasons.push({ code: 'DATA_QUALITY_MIXED_LOAD', severity: 'caution', values: {} })
  }

  // NOT_EVALUATED means nothing was actually evaluated this session (mixed
  // load, or no representative set for this metric at all) — recommendation
  // evidence is null here, never a "limited" LEVEL, which would imply a
  // real (if weak) read exists to be limited about.
  const recommendationEvidence: EvidenceLevel | null = pair.evaluationScope === 'NOT_EVALUATED'
    ? null
    : (pair.dataQualityFlags.length > 0
      ? 'limited'
      : (pair.evaluationScope === 'ALL_PRESCRIBED_WORKING_SETS' ? 'strong' : 'moderate'))

  return {
    algorithmVersion: ALGORITHM_VERSION, exerciseTemplateId, metricKind,
    observedTransition: pair.observedTransition, repDelta: pair.repDelta, rangeCompliance: pair.rangeCompliance,
    evaluationScope: pair.evaluationScope, dataQualityFlags: pair.dataQualityFlags, currentAction,
    trend: {
      recentProgressTrend: recent.state, recentWindowSessions: recent.n, recentWindowWeekSpan,
      recentPositiveSignals: recent.positive, recentNegativeSignals: recent.negative,
      currentLoadProgress: clp.state, currentLoadCycleSessions: clp.n,
      currentLoadSlope: clp.slope, currentLoadResidualSpread: clp.residualSpread,
    },
    evidence: { progress: computeProgressEvidence(recent.n, recentWindowWeekSpan), recommendation: recommendationEvidence },
    reasons, events, currentState,
    nextTargets: buildNextTargets(latest, expectation, metricKind, currentAction, policy, explicitIncrementKg, equipmentClass, observedLoadIncrements(cycles, metricKind)),
    expectation, comparableSessions, weekSpan,
  }
}
