// Progress engine — canonical types. Pure, import-free (type-only imports
// only) so every module here stays sucrase-testable with no live Supabase
// client, matching progressAggregate.ts's own established convention.
//
// Full rationale for every non-obvious shape here lives in
// docs/training/progress-engine/ALGORITHM.md and DECISION_RULES.md — this
// file is the contract, not the explanation.

import type { ProgressMetricKind } from '../progressAggregate'

export type WorkingSetKind = 'normal' | 'dropset' | 'failure'
// 'warmup' never reaches a CanonicalSet at all — excluded at normalize time.

export interface CanonicalSet {
  order: number
  kind: WorkingSetKind
  weightKg: number | null
  reps: number | null
  durationSeconds: number | null
  distanceMeters: number | null
}

export type SessionLoadStructure = 'uniform_working_load' | 'top_set_and_backoff' | 'mixed_load'

export interface CanonicalExerciseSession {
  workoutId: string
  workoutTitle: string | null
  routineId: string | null
  date: string // 'yyyy-MM-dd'
  exerciseTemplateId: string
  /** ALL non-warmup sets (dropset/failure included, tagged) — the complete
   *  ordered vector, never reduced before this point. */
  allSets: readonly CanonicalSet[]
  /** allSets minus dropsets — the sets that count toward range compliance
   *  and rep-delta comparisons (§6: failure sets ARE working sets). */
  comparableWorkingSets: readonly CanonicalSet[]
  loadStructure: SessionLoadStructure
}

export type ExpectationSource = 'routine' | 'user_override' | 'default' | 'not_configured'

export interface ExpectationRange {
  source: ExpectationSource
  repMin: number | null
  repMax: number | null
  targetSets: number
  label: string
}

export type ObservedTransition = 'NO_COMPARISON' | 'LOAD_INCREASED' | 'LOAD_DECREASED' | 'LOAD_UNCHANGED'
export type RepDelta = 'REP_INCREASE' | 'REP_DECLINE' | 'REP_NO_CHANGE' | 'NOT_APPLICABLE'
export type RangeCompliance = 'ALL_SETS_AT_TOP' | 'ALL_SETS_AT_OR_ABOVE_MIN' | 'BELOW_MINIMUM' | 'NOT_EVALUATED'
export type EvaluationScope = 'ALL_PRESCRIBED_WORKING_SETS' | 'LOGGED_SETS_ONLY' | 'TOP_SET_ONLY' | 'NOT_EVALUATED'

export type DataQualityFlag =
  | 'MISSING_PRESCRIBED_SET'
  | 'EXTRA_UNPRESCRIBED_SET'
  | 'MIXED_LOAD_SESSION'
  /** Reserved, never emitted in v1 — detecting a historical target-range
   *  change requires point-in-time target snapshots this app does not
   *  record. See docs/training/progress-engine/DATA_AND_LIMITATIONS.md. */
  | 'PROGRAM_CHANGED'

export type CurrentAction =
  | 'INSUFFICIENT_DATA'
  | 'BUILD_AT_CURRENT_LOAD'
  | 'READY_TO_INCREASE'
  | 'CONFIRM_BEFORE_INCREASING'
  | 'CONFIRM_AT_CURRENT_LOAD'
  | 'HOLD_STEADY'
  | 'REVIEW_LOAD_REDUCTION'
  | 'WATCH_FOR_PLATEAU'
  | 'WATCH_FOR_REGRESSION'

export type RecentProgressTrendState = 'INSUFFICIENT_HISTORY' | 'PROGRESSING' | 'FLAT_NORMAL_VARIATION' | 'REGRESSION_RISK'
export type CurrentLoadProgressState =
  | 'INSUFFICIENT_HISTORY' | 'TOO_EARLY_TO_JUDGE' | 'BUILDING_BASELINE'
  | 'ACCUMULATING' | 'STABLE_VARIATION' | 'POSSIBLE_PLATEAU' | 'DECLINING'

export interface TrendResult {
  recentProgressTrend: RecentProgressTrendState
  /** Actual N used — always <= policy.recentWindowSessions. The UI must
   *  disclose this literally ("Based on the last N comparable sessions"). */
  recentWindowSessions: number
  /** The recent window's OWN date span in weeks (first to last of the
   *  actual `recentWindowSessions` sessions used — never the exercise's
   *  full all-time history). §7: progress evidence is confidence in THIS
   *  windowed trend read, so its sample-size/time-span inputs must match
   *  the same window, not a broader all-time count that could overstate
   *  confidence in a trend that only ever looked at a handful of recent
   *  sessions. */
  recentWindowWeekSpan: number
  recentPositiveSignals: number
  recentNegativeSignals: number
  currentLoadProgress: CurrentLoadProgressState
  /** Sessions in the CURRENT load cycle actually used for the regression
   *  (mixed_load points excluded — see normalize.ts). */
  currentLoadCycleSessions: number
  currentLoadSlope: number | null
  currentLoadResidualSpread: number | null
}

export type EvidenceLevel = 'limited' | 'moderate' | 'strong'

export interface EvidenceResult {
  /** Supports the RECENT trend read (sample size/time span/consistency). */
  progress: EvidenceLevel
  /** Supports the CURRENT ACTION specifically — data completeness and
   *  target-source quality. NEVER touched by RPE/RIR, present or absent. */
  recommendation: EvidenceLevel | null
}

export type ReasonSeverity = 'info' | 'positive' | 'caution'
export interface DecisionReason {
  code: string
  severity: ReasonSeverity
  values: Record<string, string | number | null>
}

export type ProgressEventCode = 'LOAD_PR' | 'REP_PR_AT_LOAD' | 'TOTAL_REPS_PR_AT_LOAD' | 'ESTIMATED_STRENGTH_PR' | 'TARGET_COMPLETED' | 'PROGRESSION_STREAK'
export interface ProgressEvent {
  code: ProgressEventCode
  /** ESTIMATED_STRENGTH_PR is ALWAYS 'secondary' — an estimate never
   *  outranks a real, measured PR. The UI decides visual prominence from
   *  this field; the data model never suppresses the event for being
   *  secondary. */
  emphasis: 'primary' | 'secondary'
  values: Record<string, string | number | null>
}

export interface SessionExposure {
  date: string
  workoutId: string
  workoutTitle: string | null
  loadStructure: SessionLoadStructure
  /** The representative load for display — the uniform load, the top set's
   *  load, or the single heaviest logged set's load for a mixed session.
   *  Never a fabricated "average" across differing loads. */
  representativeWeightKg: number | null
  sets: readonly CanonicalSet[]
}

export interface CurrentStateSummary {
  previous: SessionExposure | null
  latest: SessionExposure | null
  loadChangePercent: number | null
  /** ALWAYS populated when computable (est1rm-kind metric, both sides have
   *  an eligible best set) — never nulled out for being secondary. The UI
   *  renders it as a labeled secondary line, never the headline. */
  estimatedStrengthChange: { fromKg: number; toKg: number; percent: number } | null
}

export interface NextTargetResult {
  nextSession: {
    headline: string
    loadKg: number | null
    targetSets: number | null
    minimumTotalReps: number | null
    /** The real per-position floor — every position must be met AND the
     *  total must be met; no comparable set may decrease. */
    minimumSetReps: readonly number[] | null
    explanationCode: string
  }
  progressionRequirement: {
    headline: string
    loadKg: number | null
    targetSetReps: readonly number[] | null
    explanationCode: string
  }
}

export interface ExerciseProgressResult {
  algorithmVersion: string
  exerciseTemplateId: string
  /** The exercise's own metric kind — required by the copy layer to decide
   *  whether "Load"/"kg"/percentage language is honest (weight-based
   *  metrics only) or must use metric-appropriate terminology instead
   *  (reps/duration/distance have no real load axis). */
  metricKind: ProgressMetricKind

  observedTransition: ObservedTransition
  repDelta: RepDelta
  rangeCompliance: RangeCompliance
  evaluationScope: EvaluationScope
  dataQualityFlags: readonly DataQualityFlag[]
  currentAction: CurrentAction

  trend: TrendResult
  evidence: EvidenceResult

  reasons: readonly DecisionReason[]
  events: readonly ProgressEvent[]
  currentState: CurrentStateSummary
  nextTargets: NextTargetResult | null
  expectation: ExpectationRange
  comparableSessions: number
  weekSpan: number
}

// ── Policy — the hierarchical fallback the brief specified ─────────────────
export interface ExerciseProgressionPolicy {
  recentWindowSessions: number          // default 8
  requiredTopRangeConfirmations: number // default 1 — consecutive ALL_SETS_AT_TOP reads required before READY_TO_INCREASE fires
  /** Consecutive forward-motion pairs (load-up in the metric's own positive
   *  direction, or a clean progression) required for PROGRESSION_STREAK to
   *  fire. A documented product heuristic (default 3), never a scientific
   *  threshold. */
  progressionStreakMinLength: number
  plateau: {
    graceSessions: number      // default 3
    minSessions: number        // default 5
    residualNoiseFloor: number // default 1.0 (RMS reps)
    accumulationSlopeFloor: number // default 0.3 (reps/session)
    declineSlopeFloor: number  // default 0.3 (reps/session)
  }
  decline: {
    absoluteFloor: number   // default 3 reps
    percentFloor: number    // default 0.08
  }
  loadIncrementKg: {
    barbell: number
    dumbbell: number
    machine: number
  }
}

export interface RoutineTargetLookup {
  (exerciseTemplateId: string): { repMin: number; repMax: number; targetSets: number } | null
}
export interface UserOverrideLookup {
  (exerciseTemplateId: string): { repMin: number; repMax: number } | null
}

export type { ProgressMetricKind }
