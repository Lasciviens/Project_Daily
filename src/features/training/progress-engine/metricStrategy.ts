// Progress engine — real metric-strategy dispatch. Every consumer of "which
// set is best" / "is this set even usable for this metric" / "what's the
// comparable total" goes through this ONE module, so the direction-aware
// behaviour (assisted-weight: lower is better) and the eligibility rules
// (est1rm's <=12-rep ceiling, distance requiring a real duration to pair
// with it) are never duplicated or drifted per call site.

import { est1RM } from '../progressAggregate'
import type { CanonicalSet, ProgressMetricKind } from './types'

const EST_1RM_MAX_REPS = 12

/** Metric kinds whose representative "load" is a literal weight — used to
 *  decide whether direction/transition reads compare `weightKg` (this
 *  group) or the metric's own derived value (reps/duration/distance, which
 *  have no weight axis at all for a bodyweight/timed/distance exercise). */
const WEIGHT_BASED: ReadonlySet<ProgressMetricKind> = new Set(['est1rm', 'addedWeight', 'assistedWeight'])
export function isWeightBasedMetric(metricKind: ProgressMetricKind): boolean {
  return WEIGHT_BASED.has(metricKind)
}

export interface MetricStrategy {
  /** Whether this set carries the data the metric actually needs. A set
   *  that fails this is simply invisible to the metric — never coerced to
   *  a 0/zero value (§3). */
  isEligible(set: CanonicalSet): boolean
  /** Only ever called on a set that already passed `isEligible`. */
  valueOf(set: CanonicalSet): number
  /** True when a HIGHER value is the improvement. False only for
   *  assisted-weight (less assistance = harder = better). */
  higherIsBetter: boolean
}

const STRATEGIES: Record<ProgressMetricKind, MetricStrategy> = {
  est1rm: {
    isEligible: s => s.weightKg != null && s.reps != null && s.reps > 0 && s.reps <= EST_1RM_MAX_REPS,
    valueOf: s => est1RM(s.weightKg as number, s.reps as number) as number,
    higherIsBetter: true,
  },
  reps: {
    isEligible: s => s.reps != null,
    valueOf: s => s.reps as number,
    higherIsBetter: true,
  },
  addedWeight: {
    isEligible: s => s.weightKg != null,
    valueOf: s => s.weightKg as number,
    higherIsBetter: true,
  },
  assistedWeight: {
    isEligible: s => s.weightKg != null,
    valueOf: s => s.weightKg as number,
    higherIsBetter: false,
  },
  duration: {
    isEligible: s => s.durationSeconds != null,
    valueOf: s => s.durationSeconds as number,
    higherIsBetter: true,
  },
  // Distance is deliberately gated on BOTH fields being present — this
  // repo's own rule (CLAUDE.md, EnTur/Kassalapp precedent) is to never
  // compute a derived figure (pace) from one side of a pair unless both
  // sides are actually logged together; requiring durationSeconds here
  // even though valueOf only reads distanceMeters keeps the eligibility
  // check honest about what a "distance session" actually needs to mean
  // anything (a distance with no time context is not comparable).
  distance: {
    isEligible: s => s.distanceMeters != null && s.durationSeconds != null,
    valueOf: s => s.distanceMeters as number,
    higherIsBetter: true,
  },
}

export function isMetricEligible(set: CanonicalSet, metricKind: ProgressMetricKind): boolean {
  return STRATEGIES[metricKind]?.isEligible(set) ?? false
}

export function higherIsBetterFor(metricKind: ProgressMetricKind): boolean {
  return STRATEGIES[metricKind]?.higherIsBetter ?? true
}

/** The metric's own value for a set, or null when the set doesn't carry
 *  what this metric needs — never a coerced 0. */
export function metricValueOf(set: CanonicalSet | null | undefined, metricKind: ProgressMetricKind): number | null {
  if (!set) return null
  const strategy = STRATEGIES[metricKind]
  if (!strategy || !strategy.isEligible(set)) return null
  return strategy.valueOf(set)
}

/** Selects the session's representative set for this metric — the ONE set
 *  that best represents "how this session went" for progression purposes.
 *
 *  For a `top_set_and_backoff` session, the representative set is the
 *  ACTUAL top-set role (lowest `order`), never whichever set happens to
 *  score highest under the metric — a backoff set winning by reps would
 *  misrepresent a session that was genuinely built around one heavy top
 *  set followed by lighter volume work.
 *
 *  For every other shape, the representative set is whichever ELIGIBLE set
 *  scores best under the metric's own direction (`higherIsBetter`). A
 *  session with zero eligible sets for this metric returns null — the
 *  caller must treat that as "not evaluable", never as a comparison
 *  against zero. */
export function selectRepresentativeSet(
  sets: readonly CanonicalSet[],
  loadStructure: 'uniform_working_load' | 'top_set_and_backoff' | 'mixed_load',
  metricKind: ProgressMetricKind,
): CanonicalSet | null {
  const strategy = STRATEGIES[metricKind]
  if (!strategy || sets.length === 0) return null

  if (loadStructure === 'top_set_and_backoff') {
    const top = [...sets].sort((a, b) => a.order - b.order)[0]
    return top && strategy.isEligible(top) ? top : null
  }

  const eligible = sets.filter(s => strategy.isEligible(s))
  if (eligible.length === 0) return null
  return eligible.reduce((best, s) => {
    if (!best) return s
    const bv = strategy.valueOf(best)
    const sv = strategy.valueOf(s)
    return (strategy.higherIsBetter ? sv > bv : sv < bv) ? s : best
  }, null as CanonicalSet | null)
}

/** The metric's own natural additive quantity for one set — reps for every
 *  rep-based metric kind, durationSeconds for duration, distanceMeters for
 *  distance. Returns null (never 0) when the set lacks it. */
export function quantityFor(set: CanonicalSet, metricKind: ProgressMetricKind): number | null {
  switch (metricKind) {
    case 'duration': return set.durationSeconds
    case 'distance': return set.distanceMeters
    default: return set.reps
  }
}

/** Sum of `quantityFor` across a set of comparable working sets — null
 *  (never a partial sum with implicit zeros) the moment ANY set is missing
 *  the metric's quantity, per §3. */
export function totalQuantity(sets: readonly CanonicalSet[], metricKind: ProgressMetricKind): number | null {
  if (sets.length === 0) return null
  const values = sets.map(s => quantityFor(s, metricKind))
  if (values.some(v => v == null)) return null
  return (values as number[]).reduce((a, b) => a + b, 0)
}

/** The shared "clean progression" contract — reused verbatim by both the
 *  per-pair comparability read (comparability.ts) and the recent-trend
 *  window (trend.ts), per the requirement that trend never independently
 *  classify progression from raw totals. Requires the SAME comparable set
 *  count (a set-count mismatch is never a clean comparison) and that NO
 *  individual position moved backward.
 *
 *  Deliberately NOT direction-aware via `higherIsBetter`: `quantityFor`
 *  always returns reps/duration/distance — axes that are universally "more
 *  is better" regardless of metric kind, even for assistedWeight (more reps
 *  at a FIXED assistance level is still the improvement; the assisted-weight
 *  inversion applies only to the LOAD axis — the assistance weight itself —
 *  which this function never touches). Applying `higherIsBetter` here was a
 *  real bug caught by this function's own assisted-weight test: it would
 *  have scored fewer reps at fixed assistance as "clean progression". */
export function isCleanProgression(
  prevSets: readonly CanonicalSet[],
  latestSets: readonly CanonicalSet[],
  metricKind: ProgressMetricKind,
): boolean {
  if (prevSets.length === 0 || prevSets.length !== latestSets.length) return false
  const prevQ = prevSets.map(s => quantityFor(s, metricKind))
  const latestQ = latestSets.map(s => quantityFor(s, metricKind))
  if (prevQ.some(v => v == null) || latestQ.some(v => v == null)) return false
  const prevTotal = (prevQ as number[]).reduce((a, b) => a + b, 0)
  const latestTotal = (latestQ as number[]).reduce((a, b) => a + b, 0)
  const totalImproved = latestTotal > prevTotal
  const noneRegressed = (latestQ as number[]).every((v, i) => v >= (prevQ[i] as number))
  return totalImproved && noneRegressed
}
