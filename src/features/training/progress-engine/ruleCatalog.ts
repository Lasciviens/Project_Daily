// Progress engine — the rule/copy source of truth. Every reason code,
// event code, and current-action code emitted by the engine has an entry
// here, classified into exactly one evidence tier:
//   'measured_fact' — a plain logged fact read straight off the data (a
//                     weight went up, a PR happened) — true by arithmetic,
//                     not a scientific finding, and must never be labeled
//                     "science" just because it's stated with confidence.
//   'science'       — directly supported by cited research (rare — most of
//                     this engine's numbers are NOT this tier).
//   'product_rule'  — a deterministic, useful, but non-validated heuristic
//                     (session counts, week spans, percentage floors).
//   'program_policy'— comes from the athlete's own routine/override/config.
//
// scripts/verify-progress-engine.cjs asserts every code the engine can
// possibly emit has an entry here — a code with no catalog entry fails
// verification, per the approved documentation-sync requirement.

export type EvidenceClass = 'measured_fact' | 'science' | 'product_rule' | 'program_policy'

export interface RuleCatalogEntry {
  title: string
  shortDefinition: string
  evidenceClass: EvidenceClass
  docAnchor: string
}

export const RULE_CATALOG: Record<string, RuleCatalogEntry> = {
  // ── Reason codes (comparability.ts / evaluate.ts) ──
  LOAD_INCREASED_PCT: {
    title: 'Load increased',
    shortDefinition: 'The working load went up since the last comparable session — a plain, measured fact.',
    evidenceClass: 'measured_fact', docAnchor: '#load-transition',
  },
  ALL_SETS_ABOVE_MINIMUM: {
    title: 'All sets above minimum',
    shortDefinition: 'Every set evaluated for this comparison stayed at or above your target’s rep minimum.',
    evidenceClass: 'program_policy', docAnchor: '#range-compliance',
  },
  BELOW_TARGET_MINIMUM: {
    title: 'Below target minimum',
    shortDefinition: 'At least one evaluated set fell below your target’s rep minimum after the load changed.',
    evidenceClass: 'program_policy', docAnchor: '#range-compliance',
  },
  TOP_OF_RANGE_NOT_REACHED: {
    title: 'Not yet at the top of range',
    shortDefinition: 'At least one evaluated set has not yet reached the top of your target range.',
    evidenceClass: 'program_policy', docAnchor: '#range-compliance',
  },
  REP_INCREASE_CLEAN: {
    title: 'Clean rep increase',
    shortDefinition: 'Same load, and total reps went up with no individual set going down.',
    evidenceClass: 'product_rule', docAnchor: '#rep-delta',
  },
  LOAD_DECREASED_UNKNOWN_INTENT: {
    title: 'Load decreased, intent unknown',
    shortDefinition: 'The working load went down. This app has no signal for why — never auto-labeled a deload.',
    evidenceClass: 'product_rule', docAnchor: '#load-decrease',
  },
  ASSISTANCE_REDUCED: {
    title: 'Assistance reduced',
    shortDefinition: 'Less assistance load is the improvement for an assisted-bodyweight exercise.',
    evidenceClass: 'product_rule', docAnchor: '#metric-dispatch',
  },
  NO_TREND_AT_CURRENT_LOAD: {
    title: 'No trend at this load',
    shortDefinition: 'No real upward or downward trend detected across enough comparable sessions at the current load.',
    evidenceClass: 'product_rule', docAnchor: '#current-load-progress',
  },
  DATA_QUALITY_MISSING_SET: {
    title: 'Fewer sets than prescribed',
    shortDefinition: 'Fewer working sets were logged this session than your program currently calls for.',
    evidenceClass: 'product_rule', docAnchor: '#data-quality-flags',
  },
  DATA_QUALITY_EXTRA_SET: {
    title: 'More sets than prescribed',
    shortDefinition: 'More working sets were logged this session than your program currently calls for.',
    evidenceClass: 'product_rule', docAnchor: '#data-quality-flags',
  },
  DATA_QUALITY_MIXED_LOAD: {
    title: 'Mixed load session',
    shortDefinition: 'This session’s sets don’t share one clean load or backoff shape, so a load-based comparison isn’t meaningful.',
    evidenceClass: 'product_rule', docAnchor: '#load-structure',
  },
  AWAITING_TOP_RANGE_CONFIRMATION: {
    title: 'Awaiting confirmation',
    shortDefinition: 'This session hit the top of the range, but your policy asks for more than one confirmation before recommending an increase.',
    evidenceClass: 'program_policy', docAnchor: '#current-action',
  },

  // ── Event codes (events.ts) — all-history, deterministic facts read
  // straight off the log. None of these are a scientific finding: a PR is
  // true because the arithmetic says so, not because research backs it. ──
  LOAD_PR: {
    title: 'Load PR',
    shortDefinition: 'The highest comparable working load ever logged for this exercise.',
    evidenceClass: 'measured_fact', docAnchor: '#events',
  },
  REP_PR_AT_LOAD: {
    title: 'Rep PR at this load',
    shortDefinition: 'The most reps ever logged on a single comparable set at this exact load.',
    evidenceClass: 'measured_fact', docAnchor: '#events',
  },
  TOTAL_REPS_PR_AT_LOAD: {
    title: 'Total-reps PR at this load',
    shortDefinition: 'The highest total comparable reps ever logged at this exact load and set count.',
    evidenceClass: 'measured_fact', docAnchor: '#events',
  },
  ESTIMATED_STRENGTH_PR: {
    title: 'Estimated strength PR',
    shortDefinition: 'A new high in estimated one-rep max (Epley formula) — an estimate, always secondary to the real sets above.',
    evidenceClass: 'product_rule', docAnchor: '#estimated-1rm',
  },
  TARGET_COMPLETED: {
    title: 'Target completed',
    shortDefinition: 'Every comparable working set reached the top of your target range this session.',
    evidenceClass: 'program_policy', docAnchor: '#events',
  },
  PROGRESSION_STREAK: {
    title: 'Progression streak',
    shortDefinition: 'Several consecutive sessions in a row each showed forward motion — a documented product heuristic (a minimum streak length), not a scientific threshold.',
    evidenceClass: 'product_rule', docAnchor: '#events',
  },

  // ── Current-action codes ──
  BUILD_AT_CURRENT_LOAD: {
    title: 'Build at current load',
    shortDefinition: 'Keep the same load and work toward the top of your target range.',
    evidenceClass: 'product_rule', docAnchor: '#current-action',
  },
  READY_TO_INCREASE: {
    title: 'Ready to increase',
    shortDefinition: 'Every evaluated set reached the top of your target range — a load increase is supported.',
    evidenceClass: 'product_rule', docAnchor: '#current-action',
  },
  CONFIRM_BEFORE_INCREASING: {
    title: 'Confirm before increasing',
    shortDefinition: 'A recent load increase produced at least one set below the target minimum — confirm before pushing further.',
    evidenceClass: 'product_rule', docAnchor: '#current-action',
  },
  CONFIRM_AT_CURRENT_LOAD: {
    title: 'Confirm at current load',
    shortDefinition: 'The read looks positive, but a data-quality issue means it should be confirmed, not acted on outright.',
    evidenceClass: 'product_rule', docAnchor: '#current-action',
  },
  HOLD_STEADY: {
    title: 'Hold steady',
    shortDefinition: 'Nothing here supports a change yet.',
    evidenceClass: 'product_rule', docAnchor: '#current-action',
  },
  REVIEW_LOAD_REDUCTION: {
    title: 'Review load reduction',
    shortDefinition: 'The load went down for a reason this app doesn’t know — confirm it was intentional before your next session.',
    evidenceClass: 'product_rule', docAnchor: '#load-decrease',
  },
  WATCH_FOR_PLATEAU: {
    title: 'Watch for plateau',
    shortDefinition: 'No real trend across enough comparable sessions at this load — a review signal, not a diagnosis.',
    evidenceClass: 'product_rule', docAnchor: '#current-load-progress',
  },
  WATCH_FOR_REGRESSION: {
    title: 'Watch for regression',
    shortDefinition: 'A repeated meaningful decline at this load, especially below the target minimum.',
    evidenceClass: 'product_rule', docAnchor: '#current-load-progress',
  },
  INSUFFICIENT_DATA: {
    title: 'Not enough data',
    shortDefinition: 'Not enough comparable history yet to recommend anything.',
    evidenceClass: 'product_rule', docAnchor: '#insufficient-data',
  },
}
