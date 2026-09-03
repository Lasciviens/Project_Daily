// Progress engine — pure English copy formatter. Reads the engine's
// structured output (reasons/codes/values) and renders sentences; never
// recreates decision logic. Matches this repo's English-only rule.

import { RULE_CATALOG } from './ruleCatalog'
import type { CurrentAction, EvaluationScope, EvidenceLevel, ExerciseProgressResult, RecentProgressTrendState, CurrentLoadProgressState } from './types'

export function actionLabel(action: CurrentAction): string {
  return RULE_CATALOG[action]?.title ?? action
}

export function evidenceLabel(level: EvidenceLevel): string {
  const label = level === 'strong' ? 'Strong' : level === 'moderate' ? 'Moderate' : 'Limited'
  return `${label} evidence`
}

export function scopeLabel(scope: EvaluationScope): string {
  switch (scope) {
    case 'ALL_PRESCRIBED_WORKING_SETS': return 'every prescribed set'
    case 'LOGGED_SETS_ONLY': return 'the sets actually logged'
    case 'TOP_SET_ONLY': return 'your top set'
    case 'NOT_EVALUATED': return 'not evaluated'
  }
}

export function recentTrendLabel(state: RecentProgressTrendState): string {
  switch (state) {
    case 'INSUFFICIENT_HISTORY': return 'Not enough history yet'
    case 'PROGRESSING': return 'Progressing'
    case 'FLAT_NORMAL_VARIATION': return 'Flat / normal variation'
    case 'REGRESSION_RISK': return 'Regression risk'
  }
}

export function currentLoadProgressLabel(state: CurrentLoadProgressState): string {
  switch (state) {
    case 'INSUFFICIENT_HISTORY': return 'Not enough history at this load'
    case 'TOO_EARLY_TO_JUDGE': return 'Too early to judge'
    case 'BUILDING_BASELINE': return 'Building baseline'
    case 'ACCUMULATING': return 'Accumulating'
    case 'STABLE_VARIATION': return 'Stable — noisy'
    case 'POSSIBLE_PLATEAU': return 'Possible plateau'
    case 'DECLINING': return 'Declining'
  }
}

function fmtExposure(sets: readonly { reps: number | null }[] | undefined, weightKg: number | null): string {
  if (!sets || sets.length === 0) return '—'
  const reps = sets.map(s => s.reps ?? '—').join('/')
  return weightKg != null ? `${reps} @ ${weightKg}kg` : reps
}

/** Builds the primary, dynamic explanation sentence from the result's own
 *  reasonCodes/values — the same principle `decisionHeadline()` used in the
 *  prior round, generalized to the new four-facet model. */
export function buildExplanationSentence(result: ExerciseProgressResult): string {
  const { currentState } = result
  const previousLabel = fmtExposure(currentState.previous?.sets.filter(s => s.kind !== 'dropset'), currentState.previous?.representativeWeightKg ?? null)
  const latestLabel = fmtExposure(currentState.latest?.sets.filter(s => s.kind !== 'dropset'), currentState.latest?.representativeWeightKg ?? null)

  if (result.evaluationScope === 'NOT_EVALUATED') {
    return `This session's sets don't share one clean load or match your prescribed count (logged as ${latestLabel}). Log a consistent structure next time to get a real read.`
  }
  if (result.currentAction === 'REVIEW_LOAD_REDUCTION') {
    return `Load decreased from ${previousLabel} to ${latestLabel}. Reason not recorded — confirm whether this was intentional before your next session.`
  }
  if (result.reasons.some(r => r.code === 'ASSISTANCE_REDUCED')) {
    return `Assistance dropped (${previousLabel} → ${latestLabel}) — less help is the improvement here. Reps stayed at or above the minimum on ${scopeLabel(result.evaluationScope)}.`
  }
  if (result.observedTransition === 'LOAD_INCREASED' && result.rangeCompliance !== 'BELOW_MINIMUM') {
    const pct = result.currentState.loadChangePercent
    return `Load increased${pct != null ? ` ${pct > 0 ? '+' : ''}${pct}%` : ''}, and ${scopeLabel(result.evaluationScope)} stayed at or above the minimum. Lower reps right after a load increase are expected, not a decline.`
  }
  if (result.rangeCompliance === 'BELOW_MINIMUM') {
    return `The load increased, but at least one set fell below the target minimum — confirm before increasing again.`
  }
  if (result.repDelta === 'REP_INCREASE') {
    return `Same load, and total reps went up with no set going down — real progress, not noise.`
  }
  if (result.currentAction === 'WATCH_FOR_PLATEAU') {
    return `No real trend across ${result.trend.currentLoadCycleSessions} sessions at this load. This is a review signal, not a diagnosis.`
  }
  if (result.currentAction === 'WATCH_FOR_REGRESSION') {
    return `A repeated decline across ${result.trend.currentLoadCycleSessions} sessions at this load.`
  }
  if (result.currentAction === 'READY_TO_INCREASE') {
    return `Every evaluated set reached the top of your target range.`
  }
  return `No change worth acting on at this load yet.`
}
