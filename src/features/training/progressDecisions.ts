// Progress tab decision engine — the actual missing piece this redesign
// exists to build. Pure, import-free of React/Supabase (only type-only
// imports from progressAggregate.ts), same convention as that file and
// trainingInsights.ts, so it's testable via sucrase with no live DB.
//
// Full rationale + the two rounds of user/second-review correction that
// shaped every rule below: docs/progress-redesign/PLAN.md (delete once
// this feature ships and CLAUDE.md documents the final architecture).
//
// Load-bearing corrections from that doc, restated here because they're
// the reason several things below look the way they do rather than the
// more obvious way:
//  - RPE/RIR is OPTIONAL bonus evidence, never a mandatory gate. A missing
//    RPE never blocks "increase weight" and never touches trend confidence
//    — it only caps ACTION confidence (see computeActionConfidence).
//  - Two separate confidence dimensions exist on purpose: trend confidence
//    (is this exercise really progressing?) and action confidence (how
//    confident are we in THIS SPECIFIC recommended action?). They answer
//    different questions and must never be collapsed into one number.
//  - Historical reps NEVER define the target/expectation — only the
//    routine's own stored range, an explicit user override, or a clearly
//    labeled generic default do. Historical reps measure the TREND only.
//  - "Current program" membership is explicit (current_program_routines),
//    never inferred from recency alone. A freeform session (no routine_id)
//    still counts as current — only a session tied to a KNOWN OTHER,
//    non-current routine is excluded from decision-making.
//  - "Review workload" is a PROGRAM-level judgment (computeProgramDecision),
//    never a single exercise's own status — it structurally requires
//    signals from >= 2 different exercises plus a corroborating signal.

import {
  repRangeVariedSignificantly,
  type ProgressSetRow, type ExerciseSessionPoint, type ProgressMetricKind,
} from './progressAggregate'

// ── Confidence & status vocabulary ──────────────────────────────────────────
export type ConfidenceLevel = 'low' | 'medium' | 'high'
export type ExerciseStatus = 'increase' | 'keep' | 'watch' | 'plateau' | 'insufficient_data'
export type ExpectationSource = 'routine' | 'user_override' | 'default' | 'not_configured'

export interface ExpectationRange {
  source: ExpectationSource
  repMin: number | null
  repMax: number | null
  /** Always shown next to the range so a generic guess is never mistaken
   *  for the athlete's real program. */
  label: string
}

/** Hevy's own RPE->RIR mapping (user-provided, use verbatim — do not
 *  invent a different one). RIR = reps in reserve; lower means closer to
 *  a truly maximal effort. */
export function rpeToRir(rpe: number): number {
  if (rpe >= 10) return 0
  if (rpe >= 9) return 1
  if (rpe >= 8) return 2
  // Below RPE 8 there was comfortable room — the exact RIR is less certain,
  // but 3+ is a safe floor for "not close to failure", never overclaimed
  // as a precise count Hevy itself doesn't give below 8.
  return 3
}

export interface RpeEvidence {
  averageRpe: number
  averageRir: number
  sessionsWithRpe: number
}

const EXACT_NO_RPE_CAVEAT =
  'Effort was not tracked, so confirm that your technique remained controlled before increasing the weight.'

// ── Noise band per metric kind — "no real change" threshold ────────────────
// Fixes a safety-review gap in the first draft, which only defined this for
// est1rm. Every ProgressMetricKind needs its own band, since most of this
// athlete's real exercises (41 of 44 logged) aren't e1RM-eligible at all.
function noiseBandOk(kind: ProgressMetricKind, from: number, to: number): boolean {
  if (from === 0) return to === 0
  const pctChange = Math.abs(to / from - 1)
  switch (kind) {
    case 'est1rm':          return pctChange < 0.03
    case 'reps':             return Math.abs(to - from) <= 1
    case 'addedWeight':      return pctChange < 0.05 // smallest realistic increment varies by equipment; 5% is a reasonable proxy without a stored plate/pin table
    case 'assistedWeight':   return pctChange < 0.05
    case 'duration':         return pctChange < 0.05
    case 'distance':         return pctChange < 0.05
    default:                 return pctChange < 0.05
  }
}

// ── Session comparability (current-program aware) ──────────────────────────
/** A set counts toward decision-making when its workout belongs to the
 *  explicit current program, OR was freeform (no routine_id at all — an
 *  unambiguous, un-programmed but still-current session). A set tied to a
 *  KNOWN OTHER routine (one that exists but isn't in the current-program
 *  set) is excluded — that's "old program" history, not noise to keep. */
export function filterToCurrentProgram(
  sets: ProgressSetRow[],
  currentProgramRoutineIds: ReadonlySet<string>,
): ProgressSetRow[] {
  if (currentProgramRoutineIds.size === 0) {
    // No explicit selection saved yet — nothing is excluded (matches the
    // pre-selection state: the picker hasn't been used, so every session is
    // "current" by default rather than everything reading as insufficient
    // data the moment this feature ships).
    return sets
  }
  return sets.filter(s => s.routine_id == null || currentProgramRoutineIds.has(s.routine_id))
}

const MIN_TREND_SESSIONS = 3
const MEDIUM_TREND_SESSIONS = 4
const MEDIUM_TREND_WEEKS = 2
const HIGH_TREND_SESSIONS = 6
const HIGH_TREND_WEEKS = 3

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000
}

/** Trend confidence — driven ONLY by sample size, time span, effect size
 *  and rep-range consistency. Never touched by RPE availability; can be
 *  High with zero effort data logged. */
export function computeTrendConfidence(eligible: ExerciseSessionPoint[], repRangeVaried: boolean): ConfidenceLevel {
  if (eligible.length < MIN_TREND_SESSIONS) return 'low'
  const spanWeeks = daysBetween(eligible[0].date, eligible[eligible.length - 1].date) / 7
  if (repRangeVaried) return 'low'
  if (eligible.length >= HIGH_TREND_SESSIONS && spanWeeks >= HIGH_TREND_WEEKS) return 'high'
  if (eligible.length >= MEDIUM_TREND_SESSIONS && spanWeeks >= MEDIUM_TREND_WEEKS) return 'medium'
  return 'low'
}

// ── Expectation / target source resolution ──────────────────────────────────
export interface RoutineTargetLookup {
  (exerciseTemplateId: string): { repMin: number; repMax: number } | null
}
export interface UserOverrideLookup {
  (exerciseTemplateId: string): { repMin: number; repMax: number } | null
}

const GENERIC_DEFAULT_RANGE: Record<ProgressMetricKind, { repMin: number; repMax: number } | null> = {
  est1rm:         { repMin: 8, repMax: 12 },
  addedWeight:    { repMin: 8, repMax: 12 },
  reps:           { repMin: 10, repMax: 15 },
  assistedWeight: { repMin: 8, repMax: 12 },
  duration:       null,
  distance:       null,
}

/** Priority order, per the corrected model: routine's own recorded target >
 *  the athlete's own explicit override > a clearly-labeled generic default
 *  > "Target not configured". Historical reps are NEVER consulted here —
 *  see this file's header comment for why that rung was removed. */
export function resolveExpectation(
  exerciseTemplateId: string,
  metricKind: ProgressMetricKind,
  routineTarget: RoutineTargetLookup,
  userOverride: UserOverrideLookup,
): ExpectationRange {
  const fromRoutine = routineTarget(exerciseTemplateId)
  if (fromRoutine) {
    return { source: 'routine', repMin: fromRoutine.repMin, repMax: fromRoutine.repMax, label: `Your program's target: ${fromRoutine.repMin}-${fromRoutine.repMax} reps` }
  }
  const fromOverride = userOverride(exerciseTemplateId)
  if (fromOverride) {
    return { source: 'user_override', repMin: fromOverride.repMin, repMax: fromOverride.repMax, label: `Your own target: ${fromOverride.repMin}-${fromOverride.repMax} reps` }
  }
  const fallback = GENERIC_DEFAULT_RANGE[metricKind]
  if (fallback) {
    return { source: 'default', repMin: fallback.repMin, repMax: fallback.repMax, label: `Default (no target saved): ${fallback.repMin}-${fallback.repMax} reps` }
  }
  return { source: 'not_configured', repMin: null, repMax: null, label: 'Target not configured' }
}

// ── RPE bonus evidence ───────────────────────────────────────────────────────
/** Averages RPE across a session's own working sets (any set with a value
 *  counts) — used only for the LAST N qualifying sessions a status check
 *  actually looks at, never the whole history. */
export function computeRpeEvidence(sets: ProgressSetRow[]): RpeEvidence | null {
  const withRpe = sets.filter(s => s.set_type !== 'warmup' && typeof s.rpe === 'number')
  if (withRpe.length === 0) return null
  const avgRpe = withRpe.reduce((a, s) => a + (s.rpe as number), 0) / withRpe.length
  return {
    averageRpe: Math.round(avgRpe * 10) / 10,
    averageRir: rpeToRir(avgRpe),
    sessionsWithRpe: withRpe.length,
  }
}

/** Action confidence — only meaningful for an 'increase' recommendation.
 *  Starts from trend confidence, then: RPE present with avg RIR >= 2 can
 *  raise it to High; RPE present with avg RIR 0-1 stays capped at Medium
 *  (a near-maximal set is a genuinely different signal, not a red flag);
 *  RPE absent entirely caps at Medium and requires the exact caveat
 *  sentence to be shown alongside the action. */
export function computeActionConfidence(
  trend: ConfidenceLevel,
  rpe: RpeEvidence | null,
): { confidence: ConfidenceLevel; caveat: string | null } {
  if (!rpe) return { confidence: trend === 'low' ? 'low' : 'medium', caveat: EXACT_NO_RPE_CAVEAT }
  if (rpe.averageRir >= 2) return { confidence: trend, caveat: null }
  return { confidence: trend === 'low' ? 'low' : 'medium', caveat: null }
}

// ── Per-exercise decision ────────────────────────────────────────────────────
export interface ExerciseDecisionInput {
  templateId: string
  metricKind: ProgressMetricKind
  points: ExerciseSessionPoint[]           // from computeExerciseProgression, already current-program-filtered
  qualifyingSets: ProgressSetRow[]          // the raw sets behind the last 2 comparable sessions, for RPE + completion checks
  expectation: ExpectationRange
}

export interface ExerciseDecision {
  templateId: string
  status: ExerciseStatus
  trendConfidence: ConfidenceLevel
  actionConfidence: ConfidenceLevel | null
  expectation: ExpectationRange
  comparableSessions: number
  weekSpan: number
  evidence: string[]
  rpeEvidence: RpeEvidence | null
  caveat: string | null
  nextCheck: string
}

const PLATEAU_MIN_SESSIONS = 4
const PLATEAU_MIN_WEEKS = 3

export function computeExerciseDecision(input: ExerciseDecisionInput): ExerciseDecision {
  const { templateId, metricKind, points, qualifyingSets, expectation } = input
  const eligible = points.filter(p => p.topValue != null)
  const repRangeVaried = repRangeVariedSignificantly(points)
  const trendConfidence = computeTrendConfidence(eligible, repRangeVaried)
  const weekSpan = eligible.length >= 2 ? Math.round(daysBetween(eligible[0].date, eligible[eligible.length - 1].date) / 7) : 0

  if (eligible.length < MIN_TREND_SESSIONS) {
    return {
      templateId, status: 'insufficient_data', trendConfidence: 'low', actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan,
      evidence: [`Only ${eligible.length} comparable session${eligible.length === 1 ? '' : 's'} logged — needs at least ${MIN_TREND_SESSIONS} before a reliable read is possible.`],
      rpeEvidence: null, caveat: null,
      nextCheck: `${MIN_TREND_SESSIONS - eligible.length} more session${MIN_TREND_SESSIONS - eligible.length === 1 ? '' : 's'}`,
    }
  }

  const last2 = eligible.slice(-2)
  const rpeEvidence = computeRpeEvidence(qualifyingSets)
  const evidence: string[] = []

  // "Increase" — last 2 consecutive sessions all at/above the top of the
  // expectation range. Only checkable when the expectation resolved a real
  // range (est1rm/addedWeight/reps/assistedWeight kinds).
  const atTopOfRange = expectation.repMax != null && last2.every(p => p.topReps != null && p.topReps >= (expectation.repMax as number))
  if (atTopOfRange && last2.length === 2) {
    const { confidence: actionConfidence, caveat } = computeActionConfidence(trendConfidence, rpeEvidence)
    evidence.push(`Both of the last 2 sessions reached the top of the expectation range (${expectation.label}).`)
    if (rpeEvidence) evidence.push(`Average RPE ${rpeEvidence.averageRpe} (≈${rpeEvidence.averageRir} RIR) across ${rpeEvidence.sessionsWithRpe} logged sets — effort data confirms there was room before failure.`)
    return {
      templateId, status: 'increase', trendConfidence, actionConfidence, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence, caveat,
      nextCheck: 'Next session',
    }
  }

  // "Keep" — genuinely climbing but not yet at the top of the range.
  const v0 = eligible.slice(0, Math.min(3, eligible.length)).reduce((a, p) => a + (p.topValue ?? 0), 0) / Math.min(3, eligible.length)
  const v1 = last2.reduce((a, p) => a + (p.topValue ?? 0), 0) / last2.length
  if (v1 > v0 && !noiseBandOk(metricKind, v0, v1)) {
    evidence.push(`Trending up across ${eligible.length} sessions (${Math.round(v0 * 10) / 10} → ${Math.round(v1 * 10) / 10}), but not yet at the top of ${expectation.label.toLowerCase()} on every set.`)
    return {
      templateId, status: 'keep', trendConfidence, actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
      nextCheck: expectation.repMax != null ? `Reach ${expectation.repMax} reps on every set` : 'Next session',
    }
  }

  // Flat — "watch" at 2 sessions, "possible plateau" once the evidence bar
  // (session count AND week span) is actually met.
  const flat = noiseBandOk(metricKind, v0, v1)
  if (flat) {
    if (eligible.length >= PLATEAU_MIN_SESSIONS && weekSpan >= PLATEAU_MIN_WEEKS) {
      evidence.push(`No real change across ${eligible.length} sessions spanning ${weekSpan} weeks.`)
      return {
        templateId, status: 'plateau', trendConfidence, actionConfidence: null, expectation,
        comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
        nextCheck: 'Consider a small change (a rep-range shift, a substitute exercise, or a deload)',
      }
    }
    evidence.push(`Flat over the last 2 sessions — not enough evidence yet to call this a plateau.`)
    return {
      templateId, status: 'watch', trendConfidence: 'low', actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
      nextCheck: 'One more session',
    }
  }

  // Declining, but a single exercise's own decline is never enough for a
  // program-level "review workload" call — it still gets an honest,
  // exercise-scoped "watch" here; computeProgramDecision decides whether
  // enough of these agree to escalate.
  evidence.push(`Trending down across ${eligible.length} sessions (${Math.round(v0 * 10) / 10} → ${Math.round(v1 * 10) / 10}).`)
  return {
    templateId, status: 'watch', trendConfidence, actionConfidence: null, expectation,
    comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
    nextCheck: 'One more session',
  }
}

// ── Program-level decision ───────────────────────────────────────────────────
// Deliberately three states, not the finer confirmed/likely/stable split an
// earlier draft used — the user's explicit correction: a page meant to be
// read in a few seconds needs one clear word, not a taxonomy. The evidence
// sentence underneath (built in progressCopy.ts) still carries the exact
// ratio ("3 of 4 improved"), so nothing about HOW confident is lost, only
// the number of headline buckets.
export type ProgressVerdict = 'progressing' | 'mixed' | 'insufficient_data'
export type WorkloadDecision = 'continue' | 'review_workload' | 'ease_off'

export interface ProgramDecisionInput {
  decisions: ExerciseDecision[]
  /** Whole numbers of exercises whose decline (per computeExerciseDecision's
   *  own 'watch'-from-declining path) already shows in `decisions` — the
   *  program-level check just counts how many, it doesn't re-derive it. */
  corroboratingSignal: { label: string } | null
}

export interface ProgramDecision {
  progressVerdict: ProgressVerdict
  workload: WorkloadDecision
  analyzableCount: number
  improvingCount: number
  affectedExerciseIds: string[]
  corroboratingSignal: string | null
}

const REVIEW_WORKLOAD_MIN_DECLINING = 2

export function computeProgramDecision(input: ProgramDecisionInput): ProgramDecision {
  const analyzable = input.decisions.filter(d => d.status !== 'insufficient_data')
  const improving = analyzable.filter(d => d.status === 'increase' || d.status === 'keep')
  const declining = analyzable.filter(d => d.status === 'watch' && d.evidence.some(e => e.includes('Trending down')))

  let progressVerdict: ProgressVerdict
  if (analyzable.length === 0) {
    progressVerdict = 'insufficient_data'
  } else {
    const majorityImproving = improving.length / analyzable.length > 0.5
    progressVerdict = majorityImproving ? 'progressing' : 'mixed'
  }

  let workload: WorkloadDecision = 'continue'
  if (declining.length >= REVIEW_WORKLOAD_MIN_DECLINING && input.corroboratingSignal) {
    workload = 'review_workload'
  }

  return {
    progressVerdict, workload,
    analyzableCount: analyzable.length,
    improvingCount: improving.length,
    affectedExerciseIds: declining.map(d => d.templateId),
    corroboratingSignal: workload === 'review_workload' ? (input.corroboratingSignal?.label ?? null) : null,
  }
}
