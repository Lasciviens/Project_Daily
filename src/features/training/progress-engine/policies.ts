// Progress engine — configurable thresholds and the target/policy
// resolution hierarchy. Every non-obvious number here is a documented
// product heuristic (see docs/training/progress-engine/DECISION_RULES.md),
// never presented as a scientific finding.

import type {
  ExerciseProgressionPolicy, ExpectationRange, RoutineTarget, RoutineTargetLookup, UserOverrideLookup, ProgressMetricKind,
} from './types'
import { normalizeTokens } from '../exerciseGifResolver'

export const ALGORITHM_VERSION = '2.1.0'

export const DEFAULT_POLICY: ExerciseProgressionPolicy = {
  recentWindowSessions: 8,
  requiredTopRangeConfirmations: 1,
  progressionStreakMinLength: 3,
  plateau: {
    graceSessions: 3,
    minSessions: 5,
    residualNoiseFloor: 1.0,
    accumulationSlopeFloor: 0.3,
    declineSlopeFloor: 0.3,
    relativeNoiseFloor: 0.04,
    relativeSlopeFloor: 0.01,
  },
  decline: {
    absoluteFloor: 3,
    percentFloor: 0.08,
  },
  loadIncrementKg: {
    barbell: 2.5,
    dumbbell: 2,
    machine: 2.25,
  },
}

// Bodyweight reps have NO generic default: a 10–15 default made sub-10
// pull-up progress (6/5/5 -> 8/7/6) read "below the minimum" and never count,
// so without a saved target every extra rep simply counts as progress.
const GENERIC_DEFAULT_RANGE: Record<ProgressMetricKind, { repMin: number; repMax: number } | null> = {
  est1rm:         { repMin: 8, repMax: 12 },
  addedWeight:    { repMin: 8, repMax: 12 },
  reps:           null,
  assistedWeight: { repMin: 8, repMax: 12 },
  duration:       null,
  distance:       null,
}

/** "8-12 reps", or "5 reps" for a fixed-rep prescription. */
export function repRangeLabel(repMin: number, repMax: number): string {
  return repMin === repMax ? `${repMax} reps` : `${repMin}-${repMax} reps`
}

/** A routine exercise's prescription from its own sets (hevy_routine_sets).
 *  Working sets only — warm-ups AND dropsets are excluded, the same
 *  definition a logged session's comparable working sets use (counting a
 *  dropset here once made a 3-set + dropset routine demand 4 sets forever and
 *  block "Ready to increase"). The first set with a rep range wins; with no
 *  range anywhere, the fixed `reps` Hevy stores for a no-range routine is the
 *  target (a 5×5 is repMin = repMax = 5; differing fixed reps span min–max).
 *  Null when nothing is prescribed. */
export function routineTargetFromSets(
  sets: readonly { type: string; reps: number | null; rep_range_start: number | null; rep_range_end: number | null }[],
): RoutineTarget | null {
  const working = sets.filter(s => s.type !== 'warmup' && s.type !== 'dropset')
  if (working.length === 0) return null
  const ranged = working.find(s => s.rep_range_start != null && s.rep_range_end != null)
  if (ranged) return { repMin: ranged.rep_range_start as number, repMax: ranged.rep_range_end as number, targetSets: working.length }
  const fixed = working.map(s => s.reps).filter((r): r is number => r != null && r > 0)
  if (fixed.length === 0) return null
  return { repMin: Math.min(...fixed), repMax: Math.max(...fixed), targetSets: working.length }
}

/** Priority order (approved): the athlete's own explicit override > the
 *  routine's own recorded target > a clearly-labeled generic default >
 *  "Target not configured". Historical reps are NEVER consulted here — an
 *  earlier draft used "the athlete's own observed range" as a rung and a
 *  review caught it as a self-reinforcing-loop risk (a chronic
 *  under-performer would have their own shortfall treated as "the range").
 *  Historical reps drive the TREND read only, never the target.
 *
 *  When an override supplies only the rep range (no set count of its own),
 *  the routine's own prescribed set count is preserved when one exists —
 *  an override overrides the REP RANGE, not the program's set prescription. */
export function resolveExpectation(
  exerciseTemplateId: string,
  metricKind: ProgressMetricKind,
  fallbackTargetSets: number,
  routineTarget: RoutineTargetLookup,
  userOverride: UserOverrideLookup,
): ExpectationRange {
  const fromRoutine = routineTarget(exerciseTemplateId)
  const fromOverride = userOverride(exerciseTemplateId)

  if (fromOverride) {
    const targetSets = fromRoutine?.targetSets ?? fallbackTargetSets
    return {
      source: 'user_override', repMin: fromOverride.repMin, repMax: fromOverride.repMax, targetSets,
      label: `Your own target: ${repRangeLabel(fromOverride.repMin, fromOverride.repMax)}`,
    }
  }
  if (fromRoutine) {
    return {
      source: 'routine', repMin: fromRoutine.repMin, repMax: fromRoutine.repMax, targetSets: fromRoutine.targetSets,
      label: `Your program's target: ${repRangeLabel(fromRoutine.repMin, fromRoutine.repMax)}`,
    }
  }
  const fallback = GENERIC_DEFAULT_RANGE[metricKind]
  if (fallback) {
    return {
      source: 'default', repMin: fallback.repMin, repMax: fallback.repMax, targetSets: fallbackTargetSets,
      label: `Default (no target saved): ${fallback.repMin}-${fallback.repMax} reps`,
    }
  }
  return {
    source: 'not_configured', repMin: null, repMax: null, targetSets: fallbackTargetSets,
    label: metricKind === 'reps' ? 'No rep target saved — every extra rep counts as progress' : 'Target not configured',
  }
}

/** The one real metric-strategy inversion, centralized so it's never
 *  hand-coded per branch: for an assisted-bodyweight exercise, LESS
 *  assistance weight is the positive direction. Every other metric kind
 *  reads a higher number as the positive direction. Returns null when
 *  either side is unknown — callers must not treat null as "no change". */
export function isPositiveLoadChange(metricKind: ProgressMetricKind, from: number | null, to: number | null): boolean | null {
  if (from == null || to == null) return null
  if (metricKind === 'assistedWeight') return to < from
  return to > from
}

/** Next-load resolution ladder, in the DOCUMENTED and approved priority
 *  order — an earlier version of this function checked rung 3 (observed
 *  history) before rung 2 (equipment default), silently inverting the
 *  approved priority whenever an exercise had ANY prior increment logged,
 *  however noisy or atypical. Restored order:
 *    (1) an explicit per-exercise override — no UI writes to it yet (see
 *        DATA_AND_LIMITATIONS.md), so this is always null/undefined in
 *        production today; wired here so it's a real, tested rung rather
 *        than a comment;
 *    (2) an equipment-class default, our own product convention, explicitly
 *        labeled as such;
 *    (3) the smallest positive increment ever observed in this exercise's
 *        own history (used only when neither of the above applies);
 *    (4) an honest "no fabricated number" null. */
export function resolveLoadIncrementKg(
  explicitOverrideKg: number | null,
  equipmentClass: 'barbell' | 'dumbbell' | 'machine' | null,
  observedIncrements: readonly number[],
  policy: ExerciseProgressionPolicy,
): number | null {
  if (explicitOverrideKg != null && explicitOverrideKg > 0) return explicitOverrideKg
  if (equipmentClass) return policy.loadIncrementKg[equipmentClass]
  const smallestObserved = observedIncrements.filter(v => v > 0).sort((a, b) => a - b)[0]
  if (smallestObserved != null) return smallestObserved
  return null
}

/** Derives an equipment class from the exercise's OWN title — the same
 *  token-based equipment extraction `exerciseGifResolver.ts` already uses
 *  (and ships) for GIF matching, reused here rather than inventing a second
 *  detector or a speculative new DB field (CLAUDE.md's own rule against
 *  guessing at unverified external schema). Kettlebell is mapped to
 *  'dumbbell' (a fixed-increment handheld load, the same granularity);
 *  cable/Smith machine map to 'machine' (pin/fixed-plate loaded, same
 *  granularity as a machine stack); band/bodyweight/unrecognized titles
 *  return null — there is no defensible fixed kg increment for a band, and
 *  guessing one would be exactly the fabricated number rung 4 exists to
 *  avoid. */
export function inferEquipmentClass(title: string): 'barbell' | 'dumbbell' | 'machine' | null {
  const { equip } = normalizeTokens(title)
  switch (equip) {
    case 'barbell': return 'barbell'
    case 'dumbbell':
    case 'kettlebell':
      return 'dumbbell'
    case 'machine':
    case 'smith':
    case 'cable':
      return 'machine'
    default:
      return null
  }
}
