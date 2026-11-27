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
//                     (session counts, week spans, percentage floors) —
//                     including a low-confidence S-rule (expert practice).
//   'program_policy'— comes from the athlete's own routine/override/config.
//
// Each entry also cites the rule it follows in docs/training/science.md
// (`sRules`, e.g. ['S3']) and that rule's confidence there (high / moderate /
// low); a plain logged fact or the athlete's own target cites none.
//
// scripts/verify-progress-engine.cjs asserts every code the engine can
// possibly emit has an entry here — a code with no catalog entry fails
// verification, per the approved documentation-sync requirement.

import type { DataQualityFlag } from './types'

export type EvidenceClass = 'measured_fact' | 'science' | 'product_rule' | 'program_policy'

export type ScienceConfidence = 'high' | 'moderate' | 'low'

export interface RuleCatalogEntry {
  /** For an action: its pill — one or two words (owner, 27.11.2026). */
  title: string
  shortDefinition: string
  evidenceClass: EvidenceClass
  docAnchor: string
  /** The S-rules in docs/training/science.md this follows; [] = none. */
  sRules: readonly string[]
  /** The cited rules' confidence; null when nothing is cited. */
  confidence: ScienceConfidence | null
}

const NONE = { sRules: [] as readonly string[], confidence: null }

/** The catalog entry that explains each data-quality flag — the UI shows
 *  these titles/definitions, never the raw enum. */
export const DATA_QUALITY_FLAG_CODE: Record<DataQualityFlag, string> = {
  MISSING_PRESCRIBED_SET: 'DATA_QUALITY_MISSING_SET',
  EXTRA_UNPRESCRIBED_SET: 'DATA_QUALITY_EXTRA_SET',
  MIXED_LOAD_SESSION: 'DATA_QUALITY_MIXED_LOAD',
  PROGRAM_CHANGED: 'DATA_QUALITY_PROGRAM_CHANGED',
}

export const RULE_CATALOG: Record<string, RuleCatalogEntry> = {
  // ── Reason codes (comparability.ts / evaluate.ts) ──
  LOAD_INCREASED_PCT: {
    title: 'Load increased',
    shortDefinition: 'The working load went up since the last comparable session — a plain, measured fact.',
    evidenceClass: 'measured_fact', docAnchor: '#load-transition', ...NONE,
  },
  ALL_SETS_ABOVE_MINIMUM: {
    title: 'All sets above minimum',
    shortDefinition: 'Every set evaluated for this comparison stayed at or above your target’s rep minimum.',
    evidenceClass: 'program_policy', docAnchor: '#range-compliance', ...NONE,
  },
  BELOW_TARGET_MINIMUM: {
    title: 'Below target minimum',
    shortDefinition: 'At least one evaluated set fell below your target’s rep minimum.',
    evidenceClass: 'program_policy', docAnchor: '#range-compliance', ...NONE,
  },
  TOP_OF_RANGE_NOT_REACHED: {
    title: 'Not yet at the top of range',
    shortDefinition: 'At least one evaluated set has not yet reached the top of your target range.',
    evidenceClass: 'program_policy', docAnchor: '#range-compliance', ...NONE,
  },
  REP_INCREASE_CLEAN: {
    title: 'Clean rep increase',
    shortDefinition: 'Same load, and total reps went up with no individual set going down.',
    evidenceClass: 'product_rule', docAnchor: '#rep-delta', sRules: ['S12'], confidence: 'moderate',
  },
  REPS_UNCHANGED: {
    title: 'Same as last time',
    shortDefinition: 'Same load and essentially the same reps as the last comparable session.',
    evidenceClass: 'measured_fact', docAnchor: '#rep-delta', sRules: ['S16'], confidence: 'low',
  },
  REPS_DECLINED: {
    title: 'Reps dropped',
    shortDefinition: 'Same load, but total reps fell by more than normal day-to-day noise since the last comparable session. One off day is noise; the trend over weeks is what counts.',
    evidenceClass: 'measured_fact', docAnchor: '#rep-delta', sRules: ['S16'], confidence: 'low',
  },
  LOAD_DECREASED_UNKNOWN_INTENT: {
    title: 'Load decreased, intent unknown',
    shortDefinition: 'The working load went down. This app has no signal for why — never auto-labeled a deload.',
    evidenceClass: 'product_rule', docAnchor: '#load-decrease', ...NONE,
  },
  ASSISTANCE_REDUCED: {
    title: 'Assistance reduced',
    shortDefinition: 'Less assistance load is the improvement for an assisted-bodyweight exercise.',
    evidenceClass: 'product_rule', docAnchor: '#metric-dispatch', ...NONE,
  },
  NO_TREND_AT_CURRENT_LOAD: {
    title: 'No trend at this load',
    shortDefinition: 'No real upward or downward trend detected across enough comparable sessions at the current load.',
    evidenceClass: 'product_rule', docAnchor: '#current-load-progress', sRules: ['S13'], confidence: 'moderate',
  },
  DATA_QUALITY_MISSING_SET: {
    title: 'Fewer sets than prescribed',
    shortDefinition: 'Fewer working sets were logged this session than your program currently calls for.',
    evidenceClass: 'product_rule', docAnchor: '#data-quality-flags', ...NONE,
  },
  DATA_QUALITY_EXTRA_SET: {
    title: 'More sets than prescribed',
    shortDefinition: 'More working sets were logged this session than your program currently calls for.',
    evidenceClass: 'product_rule', docAnchor: '#data-quality-flags', ...NONE,
  },
  DATA_QUALITY_MIXED_LOAD: {
    title: 'Mixed load session',
    shortDefinition: 'This session’s sets don’t share one clean load or backoff shape, so a load-based comparison isn’t meaningful.',
    evidenceClass: 'product_rule', docAnchor: '#load-structure', ...NONE,
  },
  DATA_QUALITY_PROGRAM_CHANGED: {
    title: 'Program changed',
    shortDefinition: 'Reserved — the app doesn’t record past targets, so it never claims your program changed.',
    evidenceClass: 'product_rule', docAnchor: '#data-quality-flags', ...NONE,
  },
  AWAITING_TOP_RANGE_CONFIRMATION: {
    title: 'Top of range 1 of 2',
    shortDefinition: 'Every set reached the top of the range, but not yet in 2 sessions in a row at this load (or this session was below the last one) — one more before adding weight.',
    evidenceClass: 'program_policy', docAnchor: '#current-action', sRules: ['S3', 'S10'], confidence: 'low',
  },

  // ── Event codes (events.ts) — all-history, deterministic facts read
  // straight off the log. None of these are a scientific finding: a PR is
  // true because the arithmetic says so, not because research backs it. ──
  // The engine only sees the loaded history (the last 6 months of the
  // current program), so these are "best in 6 months", never all-time PRs —
  // the Personal Records tab is the all-time list.
  LOAD_PR: {
    title: 'Best load (6 months)',
    shortDefinition: 'The heaviest comparable working load for this exercise in the last 6 months of your current program. Older sessions and other programs aren’t included — see Personal Records for all-time bests.',
    evidenceClass: 'measured_fact', docAnchor: '#events', ...NONE,
  },
  REP_PR_AT_LOAD: {
    title: 'Rep best at this load (6 months)',
    shortDefinition: 'The most reps on a single comparable set at this exact load in the last 6 months of your current program.',
    evidenceClass: 'measured_fact', docAnchor: '#events', ...NONE,
  },
  TOTAL_REPS_PR_AT_LOAD: {
    title: 'Total-reps best at this load (6 months)',
    shortDefinition: 'The highest total comparable reps at this exact load and set count in the last 6 months of your current program.',
    evidenceClass: 'measured_fact', docAnchor: '#events', ...NONE,
  },
  ESTIMATED_STRENGTH_PR: {
    title: 'Estimated strength best (6 months)',
    shortDefinition: 'A new 6-month high in estimated one-rep max (Epley formula, sets of 10 reps or fewer) — an estimate, always secondary to the real sets above.',
    evidenceClass: 'product_rule', docAnchor: '#estimated-1rm', sRules: ['S15'], confidence: 'moderate',
  },
  TARGET_COMPLETED: {
    title: 'Target completed',
    shortDefinition: 'Every comparable working set reached the top of your target range this session.',
    evidenceClass: 'program_policy', docAnchor: '#events', ...NONE,
  },
  PROGRESSION_STREAK: {
    title: 'Progression streak',
    shortDefinition: 'Several consecutive sessions in a row each showed forward motion — a documented product heuristic (a minimum streak length), not a scientific threshold.',
    evidenceClass: 'product_rule', docAnchor: '#events', ...NONE,
  },

  // ── Reason codes for the progression steps (evaluate.ts) ──
  STEP_OVER_TEN_PERCENT: {
    title: 'Big step',
    shortDefinition: 'The smallest weight step your equipment allows is over 10 % of the load, so reps come first: up to 2 past the top of the range, or jump now and expect reps to restart near the bottom (about 1 rep fewer per 2–3 % added).',
    evidenceClass: 'product_rule', docAnchor: '#load-step', sRules: ['S4', 'S5'], confidence: 'low',
  },
  BELOW_MINIMUM_TWICE_AFTER_JUMP: {
    title: 'Jump not holding yet',
    shortDefinition: 'Two sessions in a row below the minimum since the last weight step — going back to the previous load and building reps there is the usual next move.',
    evidenceClass: 'product_rule', docAnchor: '#step-back', sRules: ['S6'], confidence: 'low',
  },
  TOP_BUT_BELOW_LAST_TIME: {
    title: 'A little below last time',
    shortDefinition: 'Every set is at the top of the range, but the total is below last time at this load — a session worse than the last one never counts toward adding weight, so the 2-in-a-row count starts again.',
    evidenceClass: 'product_rule', docAnchor: '#current-action', sRules: ['S13', 'S16'], confidence: 'low',
  },
  STEPPED_BACK: {
    title: 'Stepped back',
    shortDefinition: 'Back at a lighter load right after a weight step — a normal step back, not a setback. Reps build from here.',
    evidenceClass: 'product_rule', docAnchor: '#step-back', sRules: ['S6'], confidence: 'low',
  },

  // ── Current-action codes — titles are the pills: 1–2 words, one action per
  // card (owner, 27.11.2026). Never "must", "failed" or "behind". ──
  INSUFFICIENT_DATA: {
    title: 'First time',
    shortDefinition: 'One session logged so far. Repeating it is good; one more rep anywhere is progress.',
    evidenceClass: 'product_rule', docAnchor: '#insufficient-data', sRules: ['S16'], confidence: 'low',
  },
  BUILD_AT_CURRENT_LOAD: {
    title: 'Add reps',
    shortDefinition: 'Keep the load. Matching last time is on track; one more rep anywhere is progress, until every set reaches the top of your range.',
    evidenceClass: 'product_rule', docAnchor: '#current-action', sRules: ['S12', 'S14', 'S16'], confidence: 'low',
  },
  HOLD_STEADY: {
    title: 'Add reps',
    shortDefinition: 'Same load and about the same reps as last time — that is on track (a 1-rep change is day-to-day noise). One more rep anywhere is progress.',
    evidenceClass: 'product_rule', docAnchor: '#current-action', sRules: ['S12', 'S16'], confidence: 'low',
  },
  REPEAT_AT_TOP: {
    title: 'Repeat',
    shortDefinition: 'Every set reached the top of your range. Do it once more at this load — 2 sessions in a row — and the next step is weight.',
    evidenceClass: 'product_rule', docAnchor: '#current-action', sRules: ['S3', 'S10'], confidence: 'low',
  },
  READY_TO_INCREASE: {
    title: 'Add weight',
    shortDefinition: 'Every prescribed set reached the top of your range in 2 sessions in a row at this load (for a top set + backoffs: the top set at the top, every backoff at or above the minimum). The step is about 2.5–5 % of the load for upper-body or small lifts and 5–10 % for big lower-body lifts, rounded to your equipment (ACSM 2009: 2–10 %).',
    evidenceClass: 'science', docAnchor: '#current-action', sRules: ['S3', 'S4', 'S10'], confidence: 'moderate',
  },
  ALMOST_READY: {
    title: 'Almost',
    shortDefinition: 'Ready by the reps, but the smallest step your equipment allows is over 10 % of the load. Push reps first (up to 2 past the top of the range) or jump now and accept that reps restart near the bottom — both are progress.',
    evidenceClass: 'product_rule', docAnchor: '#load-step', sRules: ['S5'], confidence: 'low',
  },
  NEW_WEIGHT: {
    title: 'New weight',
    shortDefinition: 'The first session at a heavier load. Fewer reps than before are normal after a jump; repeating them is good and one more rep anywhere is progress.',
    evidenceClass: 'product_rule', docAnchor: '#current-action', sRules: ['S5', 'S6'], confidence: 'low',
  },
  STEP_BACK: {
    title: 'Step back',
    shortDefinition: 'Two sessions in a row below the minimum since the last weight step. Go back to the previous load, aim for your last sets there and build reps again — not a setback.',
    evidenceClass: 'product_rule', docAnchor: '#step-back', sRules: ['S6'], confidence: 'low',
  },
  CONFIRM_AT_CURRENT_LOAD: {
    title: 'Check sets',
    shortDefinition: 'The read looks positive, but the logged sets differ from the program (a set missing or extra), so repeat the prescribed sets to get a clean read.',
    evidenceClass: 'product_rule', docAnchor: '#current-action', ...NONE,
  },
  LOG_COMPARABLE_SESSION: {
    title: 'Check sets',
    shortDefinition: 'The latest session couldn’t be compared (sets at mixed loads, or nothing your tracked metric can read). Log one session with a consistent structure to get a real read.',
    evidenceClass: 'product_rule', docAnchor: '#load-structure', ...NONE,
  },
  REVIEW_LOAD_REDUCTION: {
    title: 'Lighter',
    shortDefinition: 'The load went down (not right after a weight step, so the reason isn’t known). Build reps at this load like at any other; it is never read as a planned easy week.',
    evidenceClass: 'product_rule', docAnchor: '#load-decrease', ...NONE,
  },
  WATCH_FOR_PLATEAU: {
    title: 'Check',
    shortDefinition: 'No real change in 4+ sessions over 3+ weeks at this load — a review signal, not a diagnosis. Sleep, food, a lighter week or a different rep range are the usual levers.',
    evidenceClass: 'science', docAnchor: '#current-load-progress', sRules: ['S13'], confidence: 'moderate',
  },
  WATCH_FOR_REGRESSION: {
    title: 'Check',
    shortDefinition: 'Reps at this load are falling by more than day-to-day noise, session after session — worth a look at recovery before anything else.',
    evidenceClass: 'product_rule', docAnchor: '#current-load-progress', sRules: ['S13', 'S16'], confidence: 'low',
  },
}
