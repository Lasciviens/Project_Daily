// Plain-English copy formatter for progressDecisions.ts's structured output.
// Pure, import-free (type-only imports) — the UI renders these strings, it
// never recreates the decision logic in JSX. Matches this repo's English-
// only rule for all production UI copy.
import type { ExerciseStatus, ProgressVerdict, WorkloadDecision, ConfidenceLevel } from './progressDecisions'

export function statusLabel(status: ExerciseStatus): string {
  switch (status) {
    case 'increase':          return 'Increase weight'
    case 'keep':              return 'Keep this weight'
    case 'watch':             return 'Watch one more session'
    case 'plateau':           return 'Possible plateau'
    case 'insufficient_data': return 'Not enough data'
  }
}

export function statusVerb(status: ExerciseStatus): string {
  switch (status) {
    case 'increase': return '↑'
    case 'keep':      return '→'
    case 'watch':     return '!'
    case 'plateau':   return '⏸'
    default:          return '·'
  }
}

export function confidenceLabel(level: ConfidenceLevel): string {
  return level === 'high' ? 'High confidence' : level === 'medium' ? 'Medium confidence' : 'Low confidence'
}

export function progressVerdictHeadline(verdict: ProgressVerdict): string {
  switch (verdict) {
    case 'confirmed':         return 'Progress confirmed'
    case 'likely':            return 'Progress likely'
    case 'stable':            return 'Stable'
    case 'insufficient_data': return 'Not enough data yet'
  }
}

export function workloadLabel(workload: WorkloadDecision): string {
  switch (workload) {
    case 'continue':        return 'Continue'
    case 'review_workload': return 'Review workload'
    case 'ease_off':        return 'Consider easing off'
  }
}

/** Composes the two-facet sentence the user explicitly asked for, e.g.
 *  "High confidence that performance is improving. Medium confidence in
 *  increasing weight because effort data is unavailable." */
export function composeConfidenceSentence(trend: ConfidenceLevel, action: ConfidenceLevel | null, hasRpe: boolean): string {
  const trendSentence = `${confidenceLabel(trend)} that performance is improving.`
  if (action == null) return trendSentence
  const reason = hasRpe ? 'based on reps and effort together' : 'because effort data is unavailable'
  return `${trendSentence} ${confidenceLabel(action)} in increasing weight ${reason}.`
}
