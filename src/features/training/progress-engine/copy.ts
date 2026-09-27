// Progress engine — pure English copy formatter. Reads the engine's
// structured output (reasons/codes/values) and renders sentences; never
// recreates decision logic. Matches this repo's English-only rule.

import { RULE_CATALOG, DATA_QUALITY_FLAG_CODE } from './ruleCatalog'
import type {
  CanonicalSet, CurrentAction, DataQualityFlag, EvaluationScope, EvidenceLevel, ExerciseProgressResult,
  RecentProgressTrendState, CurrentLoadProgressState, ProgressMetricKind,
} from './types'
import { isWeightBasedMetric } from './metricStrategy'
import { formatSessionSets, formatQuantity, quantityUnitFor } from './format'

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

/** §6: the TOTAL quantity noun for a repDelta REP_INCREASE sentence —
 *  distinct from `axisPhrase`'s `changedNoun` (the single REPRESENTATIVE
 *  value's own noun). `quantityFor` (metricStrategy.ts) sums reps for
 *  every metric kind EXCEPT duration/distance, so only those two need a
 *  different total noun; est1rm/addedWeight/assistedWeight/reps all
 *  genuinely total reps. */
function totalQuantityNoun(metricKind: ProgressMetricKind): string {
  switch (metricKind) {
    case 'duration': return 'total duration'
    case 'distance': return 'total distance'
    default: return 'total reps'
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
    case 'FLAT_NORMAL_VARIATION': return 'Flat'
    case 'REGRESSION_RISK': return 'Slipping back'
  }
}

/** One plain sentence per trend state — shown in an InfoBubble next to the
 *  label, so no state name goes unexplained. */
export function recentTrendMeaning(state: RecentProgressTrendState): string {
  switch (state) {
    case 'INSUFFICIENT_HISTORY': return 'Fewer than 3 comparable sessions in the recent window — too few to call a direction.'
    case 'PROGRESSING': return 'Across your recent sessions, load went up or reps went up cleanly more often than they went down.'
    case 'FLAT_NORMAL_VARIATION': return 'No clear step up or down across your recent sessions — ordinary session-to-session noise.'
    case 'REGRESSION_RISK': return 'Across your recent sessions, drops (lighter load or clearly fewer reps) happened at least as often as gains.'
  }
}

export function currentLoadProgressLabel(state: CurrentLoadProgressState): string {
  switch (state) {
    case 'INSUFFICIENT_HISTORY': return 'Not enough sessions at this load'
    case 'TOO_EARLY_TO_JUDGE': return 'Too early to tell'
    case 'BUILDING_BASELINE': return 'Settling in'
    case 'ACCUMULATING': return 'Reps rising'
    case 'STABLE_VARIATION': return 'Up and down'
    case 'POSSIBLE_PLATEAU': return 'Possible plateau'
    case 'DECLINING': return 'Reps falling'
  }
}

export function currentLoadProgressMeaning(state: CurrentLoadProgressState): string {
  switch (state) {
    case 'INSUFFICIENT_HISTORY': return 'Fewer than 3 comparable sessions at this exact load — nothing to read yet.'
    case 'TOO_EARLY_TO_JUDGE': return 'Only a few sessions at this load and nothing has moved yet — normal right after a load change.'
    case 'BUILDING_BASELINE': return 'A few flat sessions at this load — still short of the 5 it takes to call a plateau.'
    case 'ACCUMULATING': return 'Your total reps (or time) at this weight are rising session to session — double progression working.'
    case 'STABLE_VARIATION': return 'Totals at this weight bounce around without a clear direction.'
    case 'POSSIBLE_PLATEAU': return 'Five or more sessions at this weight with no real change — a review signal, not a diagnosis.'
    case 'DECLINING': return 'Your totals at this weight are falling by more than normal noise, session after session.'
  }
}

/** A data-quality flag's plain title and definition (never the raw enum). */
export function dataQualityFlagCopy(flag: DataQualityFlag): { title: string; definition: string } {
  const entry = RULE_CATALOG[DATA_QUALITY_FLAG_CODE[flag]]
  return { title: entry?.title ?? flag, definition: entry?.shortDefinition ?? '' }
}

/** Metric-aware exposure summary (§4): each set's OWN load and quantity
 *  (reps, seconds or metres), grouped by load — "60 kg × 10/10/10",
 *  "102.5 kg × 5 · 80 kg × 9/8", "50s/50s/50s". Never one representative
 *  weight glued onto every set's reps. */
function fmtExposure(sets: readonly CanonicalSet[] | undefined, metricKind: ProgressMetricKind): string {
  return formatSessionSets(sets, metricKind)
}

/** The first comparable set (in order) below the rep minimum, for naming it
 *  in copy ("set 3 fell below your minimum of 8"). A top-set+backoff read
 *  only evaluated the top set, so only the top set is considered there. */
function firstSetBelowMinimum(result: ExerciseProgressResult): { position: number; reps: number } | null {
  const repMin = result.expectation.repMin
  if (repMin == null) return null
  const sets = [...(result.currentState.latest?.sets ?? [])].filter(s => s.kind !== 'dropset').sort((a, b) => a.order - b.order)
  const scoped = result.evaluationScope === 'TOP_SET_ONLY' ? sets.slice(0, 1) : sets
  const i = scoped.findIndex(s => s.reps != null && s.reps < repMin)
  return i < 0 ? null : { position: i + 1, reps: scoped[i].reps as number }
}

function totalOf(sets: readonly CanonicalSet[] | undefined, metricKind: ProgressMetricKind): number | null {
  if (!sets || sets.length === 0) return null
  const values = sets.filter(s => s.kind !== 'dropset').map(s => metricKind === 'duration' ? s.durationSeconds : metricKind === 'distance' ? s.distanceMeters : s.reps)
  if (values.some(v => v == null)) return null
  return (values as number[]).reduce((a, b) => a + b, 0)
}

/** Builds the primary, dynamic explanation sentence from the result's own
 *  reasonCodes/values — the same principle `decisionHeadline()` used in the
 *  prior round, generalized to the new four-facet model. */
export function buildExplanationSentence(result: ExerciseProgressResult): string {
  const { currentState } = result
  const previousLabel = fmtExposure(currentState.previous?.sets.filter(s => s.kind !== 'dropset'), result.metricKind)
  const latestLabel = fmtExposure(currentState.latest?.sets.filter(s => s.kind !== 'dropset'), result.metricKind)

  if (result.evaluationScope === 'NOT_EVALUATED') {
    if (result.currentState.latest?.loadStructure === 'mixed_load') {
      return `This session's sets don't share one clean load or backoff shape (logged as ${latestLabel}). Log a consistent structure next time to get a real read.`
    }
    // No representative set exists for this metric at all — e.g. every set
    // this session carries a weight this metric can't honestly account for
    // (a duration/distance set logged alongside an added weight). Never
    // implied as a load/count mismatch, which this isn't.
    return `This session has no data your tracked metric can read yet — nothing usable was logged for it. Log a session with the expected data (matching this exercise's tracked metric) to get a real read.`
  }
  if (result.currentAction === 'REVIEW_LOAD_REDUCTION') {
    const phrase = axisPhrase(result.metricKind)
    return `${phrase.decreased} from ${previousLabel} to ${latestLabel}. Reason not recorded — confirm whether this was intentional before your next session.`
  }
  if (result.reasons.some(r => r.code === 'ASSISTANCE_REDUCED')) {
    // §4: "stayed at or above the minimum" is a real compliance CLAIM —
    // never say it when rangeCompliance is NOT_EVALUATED (nothing was
    // actually checked against the range this session).
    const complianceClause = result.rangeCompliance === 'NOT_EVALUATED'
      ? `though this session's compliance with your target range wasn't evaluated`
      : `Reps stayed at or above the minimum on ${scopeLabel(result.evaluationScope)}`
    return `Assistance dropped (${previousLabel} → ${latestLabel}) — less help is the improvement here. ${complianceClause}.`
  }
  if (result.observedTransition === 'LOAD_INCREASED' && result.rangeCompliance !== 'BELOW_MINIMUM') {
    const phrase = axisPhrase(result.metricKind)
    // Percentages are only meaningful on a real load axis (§5) — a "top-set
    // reps changed +12%" reading would misrepresent a rep-count change as
    // if it were a weight change.
    const isWeight = isWeightBasedMetric(result.metricKind)
    const pct = isWeight ? result.currentState.loadChangePercent : null
    const changeClause = pct != null ? ` ${pct > 0 ? '+' : ''}${pct}%` : ''
    // §4: rangeCompliance can be NOT_EVALUATED here even though
    // observedTransition reached LOAD_INCREASED — a mixed-load session can
    // still resolve a representative value (selectRepresentativeSet's
    // general branch doesn't require a clean load shape), so this pairing
    // is real and reachable, not just defensive. Never claim compliance
    // that was never actually checked.
    const exposure = ` (${previousLabel} → ${latestLabel})`
    if (result.rangeCompliance === 'NOT_EVALUATED') {
      if (result.expectation.repMin == null && result.expectation.repMax == null) {
        return `${phrase.increased}${changeClause}${exposure} — with no rep target saved, every extra rep counts as progress.`
      }
      return `${phrase.increased}${changeClause}${exposure}, but this session's compliance with your target range wasn't evaluated (${result.currentState.latest?.loadStructure === 'mixed_load' ? 'mixed load' : 'no readable data'}).`
    }
    const caveat = isWeight
      ? ' Lower reps right after a load increase are expected, not a decline.'
      : ''
    return `${phrase.increased}${changeClause}${exposure}, and ${scopeLabel(result.evaluationScope)} stayed at or above the minimum.${caveat}`
  }
  if (result.rangeCompliance === 'BELOW_MINIMUM') {
    // T8: name what actually happened — the old copy said "load increased"
    // for every below-minimum pair, including ones where nothing changed.
    const below = firstSetBelowMinimum(result)
    const which = below ? `set ${below.position} fell below your minimum of ${result.expectation.repMin} (${below.reps} reps)` : 'at least one set fell below your minimum'
    const phrase = axisPhrase(result.metricKind)
    if (result.observedTransition === 'LOAD_INCREASED') {
      return `${phrase.increased} (${previousLabel} → ${latestLabel}), but ${which} — confirm the new load before increasing again.`
    }
    if (result.observedTransition === 'LOAD_UNCHANGED') {
      const drop = result.repDelta === 'REP_DECLINE' ? `, and total reps dropped (${previousLabel} → ${latestLabel})` : ''
      return `Same ${phrase.changedNoun}${drop}, but ${which}.`
    }
    return `${which.charAt(0).toUpperCase()}${which.slice(1)}.`
  }
  if (result.repDelta === 'REP_INCREASE') {
    // §6: metric-aware — a duration/distance exercise never had "reps" go
    // up at all; it was total duration/distance, and "Same load" is itself
    // only accurate for a real load axis (assisted/reps/duration/distance
    // each use their own changedNoun via axisPhrase, matching the rest of
    // this file's terminology-separation rule).
    const phrase = axisPhrase(result.metricKind)
    return `Same ${phrase.changedNoun}, and ${totalQuantityNoun(result.metricKind)} went up with no set going down — real progress, not noise.`
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
  const unit = quantityUnitFor(result.metricKind)
  const phrase = axisPhrase(result.metricKind)
  if (result.repDelta === 'REP_DECLINE') {
    const unitNoun = totalQuantityNoun(result.metricKind)
    const from = totalOf(currentState.previous?.sets, result.metricKind), to = totalOf(currentState.latest?.sets, result.metricKind)
    const numbers = from != null && to != null ? ` from ${formatQuantity(from, unit)} to ${formatQuantity(to, unit)}` : ''
    return `Same ${phrase.changedNoun}, but ${unitNoun} dropped${numbers} (${previousLabel} → ${latestLabel}). One off day is normal — aim to get back to last time's numbers.`
  }
  if (result.repDelta === 'REP_NO_CHANGE') {
    const add = unit === 'seconds' ? 'add a few seconds' : unit === 'metres' ? 'match or beat it' : 'add one rep'
    return `Same ${phrase.changedNoun} and about the same ${totalQuantityNoun(result.metricKind)} as last time (${latestLabel}) — repeat it and ${add}.`
  }
  if (result.currentAction === 'INSUFFICIENT_DATA') {
    return `Only one session logged so far (${latestLabel}) — repeat it and add a little to start a trend.`
  }
  if (result.dataQualityFlags.includes('MISSING_PRESCRIBED_SET') || result.dataQualityFlags.includes('EXTRA_UNPRESCRIBED_SET')) {
    return `You logged ${result.currentState.latest?.sets.filter(s => s.kind !== 'dropset').length ?? 0} working sets; your program prescribes ${result.expectation.targetSets}. Log the prescribed sets to get a clean comparison.`
  }
  return `No clear change since last time (${previousLabel} → ${latestLabel}) — repeat the session and try to add a little.`
}

/** Why there is no numeric next target — the ACTUAL cause, never one
 *  generic "wasn't clean" message (a clean session that simply repeated
 *  last time used to be told its logging was the problem). */
export function nextTargetUnavailableText(result: ExerciseProgressResult): string {
  const logged = result.currentState.latest?.sets.filter(s => s.kind !== 'dropset').length ?? 0
  switch (result.nextTargetBlocker) {
    case 'mixed_load':
      return "The latest session's sets were at mixed loads (not one working load, or one top set plus lighter backoffs), so there's no set-by-set plan to build on. Log one session with a consistent structure."
    case 'set_count_mismatch':
      return `You logged ${logged} working set${logged === 1 ? '' : 's'}, but your program prescribes ${result.expectation.targetSets}. Log all ${result.expectation.targetSets} to get a set-by-set target.`
    case 'missing_values':
      return "At least one set is missing the value this exercise is tracked by (reps, time or distance), so there's no floor to build a target from."
    case 'no_sets':
      return 'No working sets logged for this exercise yet.'
    case 'action':
      if (result.currentAction === 'REVIEW_LOAD_REDUCTION') return 'The load went down and the reason isn\'t recorded. If it was intentional (a deload, a new variation), just keep logging; if not, go back to the previous load next time.'
      return 'No numeric target for this state yet.'
    default:
      return 'No numeric target for this session.'
  }
}

/** Dynamic, per-instance explanation of the PROGRESS evidence pill (§12) —
 *  never a static "Strong/Moderate/Limited" label alone. Uses this exercise's
 *  own actual session count and time span, the same numbers the trend read
 *  itself is gated on (computeProgressEvidence in evaluate.ts), so the
 *  explanation can never drift from the number that produced it. */
export function progressEvidenceExplanation(result: ExerciseProgressResult): string {
  // §7: matches recentWindowSessions/recentWindowWeekSpan — the SAME window
  // the trend read itself used — never the exercise's full all-time
  // session count, which would overstate confidence in a read that only
  // ever looked at a handful of recent sessions.
  const { evidence, trend } = result
  const sessionsWord = `${trend.recentWindowSessions} session${trend.recentWindowSessions === 1 ? '' : 's'}`
  const spanWord = trend.recentWindowWeekSpan === 1 ? '1 week' : `${trend.recentWindowWeekSpan} weeks`
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
    return 'No recommendation evidence — nothing here was evaluable (mixed load, no data your tracked metric could read, or too few sets).'
  }
  const scope = scopeLabel(evaluationScope)
  if (dataQualityFlags.length > 0) {
    const flags = dataQualityFlags.map(f => dataQualityFlagCopy(f).title.toLowerCase()).join(', ')
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

/** Direction-aware "largest improvement" ranking score (§6) — used by
 *  ExerciseDecisionTable's sort control. `loadChangePercent` alone is not
 *  comparable across exercises without correcting for direction first: for
 *  assistedWeight, a NEGATIVE percent change (less assistance) IS the
 *  improvement, so its sign must be flipped before ranking it against every
 *  other metric's plain "higher percent = more improvement" reading. This
 *  direction-corrected percentage IS the explicit normalized score used for
 *  ranking — never a raw comparison of two unrelated metrics' percentages
 *  as if they already meant the same thing. Exercises with no computable
 *  percent sort last. */
export function improvementScore(result: ExerciseProgressResult): number {
  const pct = result.currentState.loadChangePercent
  if (pct == null) return -Infinity
  return result.metricKind === 'assistedWeight' ? -pct : pct
}
