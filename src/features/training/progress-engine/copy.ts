// Progress engine — pure English copy formatter. Reads the engine's
// structured output (reasons/codes/values) and renders sentences; never
// recreates decision logic. Matches this repo's English-only rule.

import { RULE_CATALOG } from './ruleCatalog'
import type { CurrentAction, EvaluationScope, EvidenceLevel, ExerciseProgressResult, RecentProgressTrendState, CurrentLoadProgressState, ProgressMetricKind } from './types'
import { isWeightBasedMetric } from './metricStrategy'

/** The load-axis terminology a metric kind can honestly support (§5): only
 *  est1rm/addedWeight/assistedWeight represent a literal weight — "Load
 *  increased/decreased", a percentage, and "kg" all imply that axis exists.
 *  reps/duration/distance track a different quantity entirely (top-set
 *  reps, top-set duration, top-set distance) and must never borrow load
 *  language or a load percentage, which would misrepresent what actually
 *  changed. */
function axisPhrase(metricKind: ProgressMetricKind): { increased: string; decreased: string; changedNoun: string } {
  switch (metricKind) {
    case 'assistedWeight':
      return { increased: 'Assistance decreased', decreased: 'Assistance increased', changedNoun: 'assistance' }
    case 'reps':
      return { increased: 'Your top set improved', decreased: 'Your top set dropped', changedNoun: 'top-set reps' }
    case 'duration':
      return { increased: 'Your top-set duration improved', decreased: 'Your top-set duration dropped', changedNoun: 'top-set duration' }
    case 'distance':
      return { increased: 'Your top-set distance improved', decreased: 'Your top-set distance dropped', changedNoun: 'top-set distance' }
    case 'est1rm':
    case 'addedWeight':
    default:
      return { increased: 'Load increased', decreased: 'Load decreased', changedNoun: 'load' }
  }
}

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
    const phrase = axisPhrase(result.metricKind)
    return `${phrase.decreased} from ${previousLabel} to ${latestLabel}. Reason not recorded — confirm whether this was intentional before your next session.`
  }
  if (result.reasons.some(r => r.code === 'ASSISTANCE_REDUCED')) {
    return `Assistance dropped (${previousLabel} → ${latestLabel}) — less help is the improvement here. Reps stayed at or above the minimum on ${scopeLabel(result.evaluationScope)}.`
  }
  if (result.observedTransition === 'LOAD_INCREASED' && result.rangeCompliance !== 'BELOW_MINIMUM') {
    const phrase = axisPhrase(result.metricKind)
    // Percentages are only meaningful on a real load axis (§5) — a "top-set
    // reps changed +12%" reading would misrepresent a rep-count change as
    // if it were a weight change.
    const isWeight = isWeightBasedMetric(result.metricKind)
    const pct = isWeight ? result.currentState.loadChangePercent : null
    const changeClause = pct != null ? ` ${pct > 0 ? '+' : ''}${pct}%` : ''
    const caveat = isWeight
      ? ' Lower reps right after a load increase are expected, not a decline.'
      : ''
    return `${phrase.increased}${changeClause}, and ${scopeLabel(result.evaluationScope)} stayed at or above the minimum.${caveat}`
  }
  if (result.rangeCompliance === 'BELOW_MINIMUM') {
    const phrase = axisPhrase(result.metricKind)
    return `${phrase.increased}, but at least one set fell below the target minimum — confirm before increasing again.`
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
  if (result.currentAction === 'BUILD_AT_CURRENT_LOAD' && result.reasons.some(r => r.code === 'AWAITING_TOP_RANGE_CONFIRMATION')) {
    const r = result.reasons.find(r2 => r2.code === 'AWAITING_TOP_RANGE_CONFIRMATION')
    return `This session hit the top of the range (${r?.values.confirmations ?? 1} confirmation${(r?.values.confirmations ?? 1) === 1 ? '' : 's'} so far, ${r?.values.required} needed) — one more clean session at the top before recommending an increase.`
  }
  return `No change worth acting on at this load yet.`
}

/** Dynamic, per-instance explanation of the PROGRESS evidence pill (§12) —
 *  never a static "Strong/Moderate/Limited" label alone. Uses this exercise's
 *  own actual session count and time span, the same numbers the trend read
 *  itself is gated on (computeProgressEvidence in evaluate.ts), so the
 *  explanation can never drift from the number that produced it. */
export function progressEvidenceExplanation(result: ExerciseProgressResult): string {
  const { comparableSessions, weekSpan, evidence } = result
  const sessionsWord = `${comparableSessions} session${comparableSessions === 1 ? '' : 's'}`
  const spanWord = weekSpan === 1 ? '1 week' : `${weekSpan} weeks`
  if (evidence.progress === 'strong') {
    return `Strong: ${sessionsWord} logged over ${spanWord} — enough sessions across enough time to trust the recent trend read.`
  }
  if (evidence.progress === 'moderate') {
    return `Moderate: ${sessionsWord} logged over ${spanWord} — some real history, but not yet enough sessions or time span for a confident trend read.`
  }
  return `Limited: only ${sessionsWord} logged over ${spanWord} — too little history yet for a confident trend read.`
}

/** Dynamic, per-instance explanation of the RECOMMENDATION evidence pill
 *  (§12) — grounded in the exact evaluationScope and dataQualityFlags that
 *  produced it (see evaluate.ts's recommendationEvidence computation), never
 *  a generic definition repeated for every exercise. Never touched by
 *  effort/RPE data, present or absent. */
export function recommendationEvidenceExplanation(result: ExerciseProgressResult): string {
  const { evaluationScope, dataQualityFlags, evidence } = result
  if (!evidence.recommendation) {
    return 'No recommendation evidence — this session had no comparable structure to evaluate (mixed load, or too few sets).'
  }
  const scope = scopeLabel(evaluationScope)
  if (dataQualityFlags.length > 0) {
    const flags = dataQualityFlags.map(f => f.replace(/_/g, ' ').toLowerCase()).join(', ')
    return `Limited: evaluated against ${scope}, but flagged for ${flags} — treat the current action as something to confirm, not a confident recommendation.`
  }
  if (evaluationScope === 'ALL_PRESCRIBED_WORKING_SETS') {
    return `Strong: every one of your program's prescribed working sets was evaluated this session, with no data-quality issues.`
  }
  if (evaluationScope === 'TOP_SET_ONLY') {
    return `Moderate: only the top set could be evaluated (a top-set-and-backoff session) — real, but a narrower read than a full prescribed-set evaluation.`
  }
  return `Moderate: evaluated against ${scope}, which didn't exactly match your program's prescribed set count.`
}
