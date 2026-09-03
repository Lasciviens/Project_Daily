// Progress engine — the single pure orchestration entry point. Combines
// comparability.ts / trend.ts / events.ts / targets.ts into one structured
// ExerciseProgressResult. No React, no Supabase — sucrase-testable.

import type {
  CanonicalExerciseSession, ExpectationRange, ExerciseProgressionPolicy, ExerciseProgressResult,
  DecisionReason, SessionExposure, CurrentStateSummary, EvidenceLevel,
} from './types'
import { ALGORITHM_VERSION } from './policies'
import { bestComparableSet } from './normalize'
import { buildRepresentativePoints, buildLoadCycles, computeRecentProgressTrend, computeCurrentLoadProgress } from './trend'
import { evaluatePair } from './comparability'
import { detectProgressEvents, detectEstimatedStrengthPr } from './events'
import { buildNextTargets } from './targets'
import { est1RM } from '../progressAggregate'

function round1(n: number): number { return Math.round(n * 10) / 10 }

function toExposure(session: CanonicalExerciseSession, metricKind: string): SessionExposure {
  return {
    date: session.date, workoutId: session.workoutId, workoutTitle: session.workoutTitle,
    loadStructure: session.loadStructure,
    representativeWeightKg: bestComparableSet(session, metricKind)?.weightKg ?? null,
    sets: session.allSets,
  }
}

function buildCurrentState(previous: CanonicalExerciseSession, latest: CanonicalExerciseSession, metricKind: string, loadChangePercent: number | null): CurrentStateSummary {
  let estimatedStrengthChange: CurrentStateSummary['estimatedStrengthChange'] = null
  if (metricKind === 'est1rm') {
    const e1rmOf = (s: CanonicalExerciseSession) => {
      const best = s.comparableWorkingSets.reduce((b, x) => (x.reps ?? 0) > (b?.reps ?? -1) ? x : b, s.comparableWorkingSets[0] ?? null)
      return (best?.weightKg != null && best.reps != null && best.reps <= 12) ? est1RM(best.weightKg, best.reps) : null
    }
    const from = e1rmOf(previous), to = e1rmOf(latest)
    if (from != null && to != null && from > 0) {
      estimatedStrengthChange = { fromKg: round1(from), toKg: round1(to), percent: round1((to / from - 1) * 100) }
    }
  }
  return { previous: toExposure(previous, metricKind), latest: toExposure(latest, metricKind), loadChangePercent, estimatedStrengthChange }
}

/** How much history supports the RECENT trend read — sample size and time
 *  span, over the windowed series. Gated the same way regardless of which
 *  trend axis is being displayed. */
function computeProgressEvidence(comparableSessions: number, weekSpan: number): EvidenceLevel {
  if (comparableSessions >= 6 && weekSpan >= 3) return 'strong'
  if (comparableSessions >= 4 && weekSpan >= 2) return 'moderate'
  return 'limited'
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000
}

export interface EvaluateExerciseProgressInput {
  exerciseTemplateId: string
  metricKind: string
  sessions: readonly CanonicalExerciseSession[] // already current-program-filtered, ascending by date
  expectation: ExpectationRange
}

export function evaluateExerciseProgress(input: EvaluateExerciseProgressInput, policy: ExerciseProgressionPolicy): ExerciseProgressResult {
  const { exerciseTemplateId, metricKind, sessions, expectation } = input
  const comparableSessions = sessions.length
  const weekSpan = comparableSessions >= 2 ? Math.round(daysBetween(sessions[0].date, sessions[sessions.length - 1].date) / 7) : 0

  if (comparableSessions < 2) {
    return {
      algorithmVersion: ALGORITHM_VERSION, exerciseTemplateId,
      observedTransition: 'NO_COMPARISON', repDelta: 'NOT_APPLICABLE', rangeCompliance: 'NOT_EVALUATED', evaluationScope: 'NOT_EVALUATED',
      dataQualityFlags: [], currentAction: 'INSUFFICIENT_DATA',
      trend: { recentProgressTrend: 'INSUFFICIENT_HISTORY', recentWindowSessions: comparableSessions, recentPositiveSignals: 0, recentNegativeSignals: 0, currentLoadProgress: 'INSUFFICIENT_HISTORY', currentLoadCycleSessions: 0, currentLoadSlope: null, currentLoadResidualSpread: null },
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
  const clp = computeCurrentLoadProgress(currentCycle.points, policy)
  const recent = computeRecentProgressTrend(points, policy)

  // Precedence: a real, fresh improvement this pair overrides a plateau/
  // regression read from the longer window — the two-point read wins only
  // when it shows genuine forward motion; the long-window read governs
  // otherwise.
  let currentAction = pair.currentAction
  const freshImprovement = pair.observedTransition === 'LOAD_INCREASED' && pair.rangeCompliance !== 'BELOW_MINIMUM'
    || pair.repDelta === 'REP_INCREASE'
  if (!freshImprovement && pair.dataQualityFlags.length === 0) {
    if (clp.state === 'POSSIBLE_PLATEAU') currentAction = 'WATCH_FOR_PLATEAU'
    else if (clp.state === 'DECLINING') currentAction = 'WATCH_FOR_REGRESSION'
  }

  const strengthPr = detectEstimatedStrengthPr(sessions, latestIndex, metricKind)
  const events = [
    ...detectProgressEvents(points, latestIndex, metricKind, latest, expectation),
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
  for (const flag of pair.dataQualityFlags) {
    if (flag === 'MISSING_PRESCRIBED_SET') reasons.push({ code: 'DATA_QUALITY_MISSING_SET', severity: 'caution', values: {} })
    if (flag === 'EXTRA_UNPRESCRIBED_SET') reasons.push({ code: 'DATA_QUALITY_EXTRA_SET', severity: 'caution', values: {} })
    if (flag === 'MIXED_LOAD_SESSION') reasons.push({ code: 'DATA_QUALITY_MIXED_LOAD', severity: 'caution', values: {} })
  }

  const recommendationEvidence: EvidenceLevel = pair.dataQualityFlags.length > 0
    ? 'limited'
    : (pair.evaluationScope === 'ALL_PRESCRIBED_WORKING_SETS' ? 'strong' : 'moderate')

  return {
    algorithmVersion: ALGORITHM_VERSION, exerciseTemplateId,
    observedTransition: pair.observedTransition, repDelta: pair.repDelta, rangeCompliance: pair.rangeCompliance,
    evaluationScope: pair.evaluationScope, dataQualityFlags: pair.dataQualityFlags, currentAction,
    trend: {
      recentProgressTrend: recent.state, recentWindowSessions: recent.n,
      recentPositiveSignals: recent.positive, recentNegativeSignals: recent.negative,
      currentLoadProgress: clp.state, currentLoadCycleSessions: clp.n,
      currentLoadSlope: clp.slope, currentLoadResidualSpread: clp.residualSpread,
    },
    evidence: { progress: computeProgressEvidence(comparableSessions, weekSpan), recommendation: recommendationEvidence },
    reasons, events, currentState,
    nextTargets: buildNextTargets(latest, expectation, metricKind),
    expectation, comparableSessions, weekSpan,
  }
}
