// Progress tab decision engine — the actual missing piece this redesign
// exists to build. Pure, import-free of React/Supabase (only type-only
// imports from progressAggregate.ts), same convention as that file and
// trainingInsights.ts, so it's testable via sucrase with no live DB.
//
// Full rationale + the rounds of user/second-review correction that shaped
// every rule below: docs/progress-redesign/PLAN.md (delete once this
// feature ships and CLAUDE.md documents the final architecture).
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
//  - A THIRD correction round (2026-09-02): the evidence sentence used to
//    show a bare, unlabeled number pair ("10.9 -> 12.7") that the user
//    correctly identified as meaningless without knowing it was an
//    estimated 1RM. The PRIMARY evidence is now always the actual raw sets
//    from the last comparable workout vs the latest one (currentState
//    below) — a derived metric like estimated 1RM is secondary context,
//    always labeled, never the headline. This round also fixed a real
//    confidence bug: a deliberate weight increase changes the rep count by
//    design, but the rep-range-varied check was treating that expected
//    change as a DATA-QUALITY problem and crushing trend confidence to Low
//    — it now only counts against confidence when the rep swing ISN'T
//    explained by a logged load change.

import {
  repRangeVariedSignificantly,
  type ProgressSetRow, type ExerciseSessionPoint, type ProgressMetricKind,
} from './progressAggregate'

// ── Confidence & status vocabulary ──────────────────────────────────────────
export type ConfidenceLevel = 'low' | 'medium' | 'high'
export type ExerciseStatus = 'increase' | 'keep' | 'watch' | 'plateau' | 'insufficient_data'
export type ExpectationSource = 'routine' | 'user_override' | 'default' | 'not_configured'

/** Stable machine-readable identifiers for WHY a decision was made —
 *  progressCopy.ts turns these into the specific headline ("Successful
 *  load increase" vs "Rep progression" vs ...) and can compose fresh
 *  sentences from them; they're also what a test asserts against instead
 *  of matching prose substrings. Deliberately a flat string union, not a
 *  fully separate template-per-code renderer — this file still writes the
 *  primary evidence sentence itself (a documented simplification vs. a
 *  fully decoupled codes-to-copy layer, acceptable at this scope). */
export type ReasonCode =
  | 'INSUFFICIENT_SESSIONS'
  | 'TOP_OF_RANGE_REACHED'
  | 'LOAD_INCREASED'
  | 'LOAD_DECREASED'
  | 'LOAD_UNCHANGED'
  | 'ALL_SETS_INSIDE_TARGET_RANGE'
  | 'BELOW_TARGET_MINIMUM'
  | 'REP_PROGRESSION'
  | 'FLAT_NO_CHANGE'
  | 'TREND_DOWN'
  | 'SINGLE_SESSION_DROP'

export interface ExpectationRange {
  source: ExpectationSource
  repMin: number | null
  repMax: number | null
  /** Always shown next to the range so a generic guess is never mistaken
   *  for the athlete's real program. */
  label: string
}

/** One workout's actual logged result for this exercise — the number a
 *  user recognizes on sight, never a derived metric. */
export interface ExposureSummary {
  date: string
  weightKg: number | null
  reps: number | null
}

export interface CurrentStateSummary {
  previous: ExposureSummary | null
  latest: ExposureSummary | null
  /** null when either exposure has no weight (e.g. a bodyweight-reps
   *  exercise) or nothing changed. */
  loadChangePercent: number | null
  /** ONLY populated for 'est1rm'-kind exercises, and ALWAYS labeled as an
   *  estimate in the UI — this is exactly the number that used to leak out
   *  unlabeled as "10.9 -> 12.7". Secondary context, never the headline. */
  estimatedStrengthChange: { fromKg: number; toKg: number; percent: number } | null
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
const WEIGHT_EPSILON = 0.01

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000
}

/** Trend confidence — driven ONLY by sample size, time span, effect size
 *  and UNEXPLAINED rep-range inconsistency. Never touched by RPE
 *  availability; can be High with zero effort data logged.
 *  `repRangeVariedUnexplained` must already have any load-change-caused
 *  variation subtracted out by the caller — see computeExerciseDecision. */
export function computeTrendConfidence(eligible: ExerciseSessionPoint[], repRangeVariedUnexplained: boolean): ConfidenceLevel {
  if (eligible.length < MIN_TREND_SESSIONS) return 'low'
  const spanWeeks = daysBetween(eligible[0].date, eligible[eligible.length - 1].date) / 7
  if (repRangeVariedUnexplained) return 'low'
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

export function computeActionConfidence(
  trend: ConfidenceLevel,
  rpe: RpeEvidence | null,
): { confidence: ConfidenceLevel; caveat: string | null } {
  if (!rpe) return { confidence: trend === 'low' ? 'low' : 'medium', caveat: EXACT_NO_RPE_CAVEAT }
  if (rpe.averageRir >= 2) return { confidence: trend, caveat: null }
  return { confidence: trend === 'low' ? 'low' : 'medium', caveat: null }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
function pctChange(from: number, to: number): number {
  return Math.round((to / from - 1) * 1000) / 10
}
function toExposure(p: ExerciseSessionPoint): ExposureSummary {
  return { date: p.date, weightKg: p.topWeightKg, reps: p.topReps }
}

/** Builds the always-real, always-recognizable previous/latest comparison
 *  the user asked for, plus a clearly-labeled secondary estimated-strength
 *  delta ONLY for est1rm-kind exercises. */
function buildCurrentState(previous: ExerciseSessionPoint, latest: ExerciseSessionPoint, metricKind: ProgressMetricKind): CurrentStateSummary {
  const loadChangePercent = previous.topWeightKg != null && latest.topWeightKg != null && previous.topWeightKg > 0
    ? pctChange(previous.topWeightKg, latest.topWeightKg)
    : null
  const estimatedStrengthChange = metricKind === 'est1rm' && previous.topValue != null && latest.topValue != null && previous.topValue > 0
    ? { fromKg: round1(previous.topValue), toKg: round1(latest.topValue), percent: pctChange(previous.topValue, latest.topValue) }
    : null
  return { previous: toExposure(previous), latest: toExposure(latest), loadChangePercent, estimatedStrengthChange }
}

function fmtExposure(e: ExposureSummary | null): string {
  if (!e) return '—'
  if (e.weightKg != null && e.reps != null) return `${e.weightKg} kg × ${e.reps}`
  if (e.reps != null) return `${e.reps} reps`
  if (e.weightKg != null) return `${e.weightKg} kg`
  return '—'
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
  reasonCodes: ReasonCode[]
  currentState: CurrentStateSummary | null
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
  const weekSpan = eligible.length >= 2 ? Math.round(daysBetween(eligible[0].date, eligible[eligible.length - 1].date) / 7) : 0

  if (eligible.length < MIN_TREND_SESSIONS) {
    return {
      templateId, status: 'insufficient_data', reasonCodes: ['INSUFFICIENT_SESSIONS'], currentState: null,
      trendConfidence: 'low', actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan,
      evidence: [`Only ${eligible.length} comparable session${eligible.length === 1 ? '' : 's'} logged — needs at least ${MIN_TREND_SESSIONS} before a reliable read is possible.`],
      rpeEvidence: null, caveat: null,
      nextCheck: `${MIN_TREND_SESSIONS - eligible.length} more session${MIN_TREND_SESSIONS - eligible.length === 1 ? '' : 's'}`,
    }
  }

  const previous = eligible[eligible.length - 2]
  const latest = eligible[eligible.length - 1]
  const currentState = buildCurrentState(previous, latest, metricKind)

  const weightChanged = previous.topWeightKg != null && latest.topWeightKg != null && Math.abs(latest.topWeightKg - previous.topWeightKg) > WEIGHT_EPSILON
  const loadIncreased = weightChanged && (latest.topWeightKg as number) > (previous.topWeightKg as number)

  // A deliberate weight increase changes the rep count BY DESIGN — that's
  // not a data-quality problem, so it must never crush confidence to Low
  // the way an erratic, unexplained rep swing should. Only an UNEXPLAINED
  // variation (no logged weight change between the two exposures driving
  // it) counts against trend confidence.
  const rawVaried = repRangeVariedSignificantly(points)
  const trendConfidence = computeTrendConfidence(eligible, rawVaried && !weightChanged)

  const rpeEvidence = computeRpeEvidence(qualifyingSets)
  const evidence: string[] = [`Last comparable workout: ${fmtExposure(currentState.previous)}. Latest: ${fmtExposure(currentState.latest)}.`]
  const reasonCodes: ReasonCode[] = []

  // 1. Top of range on the last 2 exposures -> ready to increase.
  const atTopOfRange = expectation.repMax != null && [previous, latest].every(p => p.topReps != null && p.topReps >= (expectation.repMax as number))
  if (atTopOfRange) {
    reasonCodes.push('TOP_OF_RANGE_REACHED')
    const { confidence: actionConfidence, caveat } = computeActionConfidence(trendConfidence, rpeEvidence)
    evidence.push(`Both of the last 2 sessions reached the top of ${expectation.label.toLowerCase()}.`)
    if (rpeEvidence) evidence.push(`Average RPE ${rpeEvidence.averageRpe} (≈${rpeEvidence.averageRir} RIR) across ${rpeEvidence.sessionsWithRpe} logged sets — effort data confirms there was room before failure.`)
    return {
      templateId, status: 'increase', reasonCodes, currentState, trendConfidence, actionConfidence, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence, caveat,
      nextCheck: 'Next session',
    }
  }

  // 2. The load went up since the last comparable workout — a real,
  // recognizable event that must be classified on its own terms, never
  // folded into a generic "total went down so this looks bad" reading.
  if (loadIncreased && latest.topReps != null) {
    reasonCodes.push('LOAD_INCREASED')
    if (currentState.loadChangePercent != null) evidence.push(`Load increased by ${currentState.loadChangePercent > 0 ? '+' : ''}${currentState.loadChangePercent}%.`)
    const belowMin = expectation.repMin != null && latest.topReps < expectation.repMin
    if (belowMin) {
      reasonCodes.push('BELOW_TARGET_MINIMUM')
      evidence.push(`Reps (${latest.topReps}) fell below the ${expectation.repMin}-rep target minimum at the new weight — the increase may have been a bit early.`)
      return {
        templateId, status: 'watch', reasonCodes, currentState, trendConfidence, actionConfidence: null, expectation,
        comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
        nextCheck: 'Confirm reps recover at this weight next session',
      }
    }
    reasonCodes.push('ALL_SETS_INSIDE_TARGET_RANGE')
    evidence.push(`Reps are still inside ${expectation.label.toLowerCase()} — lower reps right after a weight increase are expected, not a decline.`)
    return {
      templateId, status: 'keep', reasonCodes, currentState, trendConfidence, actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
      nextCheck: expectation.repMax != null
        ? `Keep ${latest.topWeightKg} kg until you reach ${expectation.repMax} reps on every set`
        : 'Next session',
    }
  }

  // 3. Same weight as last time — a plain rep-progression read.
  if (!weightChanged && latest.topReps != null && previous.topReps != null && latest.topReps > previous.topReps) {
    reasonCodes.push('LOAD_UNCHANGED', 'REP_PROGRESSION')
    evidence.push(`Same weight as last time, and reps went up (${previous.topReps} → ${latest.topReps}).`)
    return {
      templateId, status: 'keep', reasonCodes, currentState, trendConfidence, actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
      nextCheck: expectation.repMax != null ? `Reach ${expectation.repMax} reps on every set` : 'Next session',
    }
  }

  // 4. A weight DECREASE (deload/technique reset) — neither a decline nor
  // a progression; flagged plainly rather than forced into either bucket.
  if (weightChanged && !loadIncreased) {
    reasonCodes.push('LOAD_DECREASED')
    evidence.push(`Weight dropped from ${previous.topWeightKg} kg to ${latest.topWeightKg} kg — likely a deliberate deload or a technique reset, not a performance decline.`)
    return {
      templateId, status: 'watch', reasonCodes, currentState, trendConfidence, actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
      nextCheck: 'See how the next session at this weight goes',
    }
  }

  // 5. No weight change and no rep gain at the immediate previous/latest
  // pair — fall back to the LONGER window (this is inherently a multi-
  // session question, not a two-point one) to tell flat/plateau/decline
  // apart, exactly as before.
  const v0 = eligible.slice(0, Math.min(3, eligible.length)).reduce((a, p) => a + (p.topValue ?? 0), 0) / Math.min(3, eligible.length)
  const v1 = eligible.slice(-2).reduce((a, p) => a + (p.topValue ?? 0), 0) / 2
  const flat = noiseBandOk(metricKind, v0, v1)

  if (flat) {
    if (eligible.length >= PLATEAU_MIN_SESSIONS && weekSpan >= PLATEAU_MIN_WEEKS) {
      reasonCodes.push('FLAT_NO_CHANGE')
      evidence.push(`No real change across ${eligible.length} sessions spanning ${weekSpan} weeks.`)
      return {
        templateId, status: 'plateau', reasonCodes, currentState, trendConfidence, actionConfidence: null, expectation,
        comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
        nextCheck: 'Consider a small change (a rep-range shift, a substitute exercise, or a deload)',
      }
    }
    reasonCodes.push('SINGLE_SESSION_DROP')
    evidence.push('Flat over the last 2 sessions — not enough evidence yet to call this a plateau.')
    return {
      templateId, status: 'watch', reasonCodes, currentState, trendConfidence: 'low', actionConfidence: null, expectation,
      comparableSessions: eligible.length, weekSpan, evidence, rpeEvidence: null, caveat: null,
      nextCheck: 'One more session',
    }
  }

  // Declining, but a single exercise's own decline is never enough for a
  // program-level "review workload" call — it still gets an honest,
  // exercise-scoped "watch" here; computeProgramDecision decides whether
  // enough of these agree to escalate.
  reasonCodes.push('TREND_DOWN')
  if (metricKind === 'est1rm' && currentState.estimatedStrengthChange) {
    evidence.push(`Estimated strength (from weight × reps, not a tested max) has drifted from ${currentState.estimatedStrengthChange.fromKg} kg to ${currentState.estimatedStrengthChange.toKg} kg over the last ${eligible.length} sessions.`)
  }
  return {
    templateId, status: 'watch', reasonCodes, currentState, trendConfidence, actionConfidence: null, expectation,
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
  const declining = analyzable.filter(d => d.status === 'watch' && d.reasonCodes.includes('TREND_DOWN'))

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
