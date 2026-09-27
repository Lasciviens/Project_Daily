// Progress engine — the two trend axes, kept structurally separate per the
// approved contract: `recentProgressTrend` (a configurable recent window,
// preserving earlier successful load cycles) and `currentLoadProgress`
// (scoped to the CURRENT stable-load segment only). All-history PR/event
// detection lives in events.ts and is never windowed.

import type { CanonicalExerciseSession, CanonicalSet, ExerciseProgressionPolicy, ExpectationRange, RecentProgressTrendState, CurrentLoadProgressState, ProgressMetricKind } from './types'
import { selectRepresentativeSet, totalQuantity, metricValueOf, isCleanProgression, isWeightBasedMetric, isQualifiedForPositiveSignal } from './metricStrategy'
import { isPositiveLoadChange } from './policies'

function daysBetweenDates(a: string, b: string): number {
  return Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000
}

export interface RepresentativePoint {
  date: string
  /** The session's own workout id — a stable key (two sessions can share a date). */
  workoutId?: string
  loadStructure: CanonicalExerciseSession['loadStructure']
  /** The representative set's raw weight — the load-cycle grouping key.
   *  Null for a metric/session with no weight axis (reps/duration/distance
   *  types) or when no representative set could be selected at all. */
  weightKg: number | null
  /** The representative set's own metric-specific value (e1RM/reps/
   *  addedWeight/assistedWeight/duration/distance) — null when the metric
   *  isn't evaluable for this session (never a coerced 0). */
  metricValue: number | null
  /** This session's own comparable working sets — kept so the shared
   *  `isCleanProgression` contract can be reused verbatim here instead of
   *  a second, independent raw-total comparison. */
  sets: readonly CanonicalSet[]
  comparableSetCount: number
  /** Σ of the metric's own natural quantity across `sets` — null the
   *  moment any set is missing it, or the session is mixed_load. */
  total: number | null
}

export function buildRepresentativePoints(sessions: readonly CanonicalExerciseSession[], metricKind: ProgressMetricKind): RepresentativePoint[] {
  return sessions.map(s => {
    const rep = s.loadStructure === 'mixed_load' ? null : selectRepresentativeSet(s.comparableWorkingSets, s.loadStructure, metricKind)
    return {
      date: s.date,
      workoutId: s.workoutId,
      loadStructure: s.loadStructure,
      weightKg: rep?.weightKg ?? null,
      metricValue: metricValueOf(rep, metricKind),
      sets: s.comparableWorkingSets,
      comparableSetCount: s.comparableWorkingSets.length,
      total: s.loadStructure === 'mixed_load' ? null : totalQuantity(s.comparableWorkingSets, metricKind),
    }
  })
}

export interface LoadCycle { weightKg: number | null; points: RepresentativePoint[] }

/** Partitions the ordered point series into maximal runs sharing one
 *  representative load. For metric kinds with no weight axis, every point
 *  has `weightKg: null`, so the whole history is one cycle — correct: a
 *  reps/duration/distance exercise has no "load" dimension to cycle on,
 *  and its progression is driven entirely by `currentLoadProgress`'s own
 *  totals regression instead. */
export function buildLoadCycles(points: readonly RepresentativePoint[]): LoadCycle[] {
  const cycles: LoadCycle[] = []
  for (const p of points) {
    const last = cycles[cycles.length - 1]
    if (!last || last.weightKg !== p.weightKg) cycles.push({ weightKg: p.weightKg, points: [p] })
    else last.points.push(p)
  }
  return cycles
}

/** Decline detection ONLY — never used to gate a positive read (a clean
 *  progression counts regardless of magnitude, per `isCleanProgression` in
 *  `metricStrategy.ts`). A documented product heuristic, not a scientific
 *  threshold — see DECISION_RULES.md. */
export function meaningfulDeclineReps(prevTotal: number, policy: ExerciseProgressionPolicy): number {
  return Math.max(policy.decline.absoluteFloor, Math.ceil(prevTotal * policy.decline.percentFloor))
}

/** Least-squares fit over session index — directional consistency, not
 *  raw spread. A perfectly monotonic climb (e.g. 20,21,22,23,24) has a
 *  near-zero residual from its own trend line even though its raw
 *  max-min spread is large; a genuinely noisy flat series does not. This
 *  is the exact replacement for the retired `repRangeVariedSignificantly`
 *  (which operated on a single top-set rep count and needed a bolt-on
 *  "explained by a weight change" patch this design makes unnecessary). */
export function linearFit(y: readonly number[]): { slope: number; residualSpread: number } {
  const n = y.length
  const x = y.map((_, i) => i)
  const xMean = x.reduce((a, b) => a + b, 0) / n
  const yMean = y.reduce((a, b) => a + b, 0) / n
  const num = x.reduce((s, xi, i) => s + (xi - xMean) * (y[i] - yMean), 0)
  const den = x.reduce((s, xi) => s + (xi - xMean) ** 2, 0)
  const slope = den === 0 ? 0 : num / den
  const intercept = yMean - slope * xMean
  const residuals = y.map((v, i) => v - (slope * x[i] + intercept))
  const residualSpread = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / n)
  return { slope, residualSpread }
}

/** One-sided 95% critical t values by degrees of freedom (n − 2) — the
 *  significance bar a slope must clear to count as a real direction. */
const T_CRITICAL_ONE_SIDED_95 = [Infinity, 6.314, 2.92, 2.353, 2.132, 2.015, 1.943, 1.895, 1.86, 1.833, 1.812]

/** |slope| / standard error of the slope for a least-squares fit over
 *  session index (x = 0..n−1). Infinity for a perfect non-flat fit. */
export function slopeTStatistic(slope: number, residualSpread: number, n: number): number {
  if (n < 3) return 0
  const ssr = n * residualSpread * residualSpread
  const s = Math.sqrt(ssr / (n - 2))
  const sxx = (n * (n * n - 1)) / 12
  const se = s / Math.sqrt(sxx)
  if (se === 0) return slope === 0 ? 0 : Infinity
  return Math.abs(slope) / se
}

export function tCriticalOneSided95(n: number): number {
  const df = n - 2
  if (df <= 0) return Infinity
  return df < T_CRITICAL_ONE_SIDED_95.length ? T_CRITICAL_ONE_SIDED_95[df] : 1.75
}

/** The floors in the series' OWN unit: absolute reps for rep-counted totals,
 *  a share of the mean for seconds/metres (an absolute "1 rep" noise floor
 *  applied to plank seconds meant a timed hold could never read ACCUMULATING
 *  or POSSIBLE_PLATEAU at all). */
export function currentLoadFloors(metricKind: ProgressMetricKind, series: readonly number[], policy: ExerciseProgressionPolicy): { noise: number; accumulation: number; decline: number } {
  const p = policy.plateau
  if (metricKind === 'duration' || metricKind === 'distance') {
    const mean = Math.abs(series.reduce((a, b) => a + b, 0) / (series.length || 1))
    return { noise: p.relativeNoiseFloor * mean, accumulation: p.relativeSlopeFloor * mean, decline: p.relativeSlopeFloor * mean }
  }
  return { noise: p.residualNoiseFloor, accumulation: p.accumulationSlopeFloor, decline: p.declineSlopeFloor }
}

/** Among points with a real total, picks the comparable-set-count that most
 *  of them actually share — the "current" set-count segment to regress
 *  over. A 2-set session must never be regressed alongside a 3-set session:
 *  their totals aren't the same unit (more sets is mechanically more total
 *  quantity, independent of any real progress), so mixing them would read a
 *  pure set-count change as a trend. Ties prefer the LATEST point's own set
 *  count — the segment most relevant to "how is the CURRENT structure
 *  going" — over an arbitrary earlier value. */
function dominantSetCount(points: readonly RepresentativePoint[]): number {
  const counts = new Map<number, number>()
  for (const p of points) counts.set(p.comparableSetCount, (counts.get(p.comparableSetCount) ?? 0) + 1)
  const latestCount = points[points.length - 1].comparableSetCount
  let best = latestCount
  let bestFreq = counts.get(latestCount) ?? 0
  for (const [setCount, freq] of counts) {
    if (freq > bestFreq) { best = setCount; bestFreq = freq }
  }
  return best
}

/** Scoped to the CURRENT load cycle only (a fixed representative load/
 *  assistance level) — so what's being regressed is `total`, the metric's
 *  own additive quantity (reps/duration/distance), which is ALWAYS "more is
 *  better" regardless of metric kind (the assisted-weight inversion applies
 *  to the load axis, which changes BETWEEN cycles, never within one).
 *  `metricKind` only picks the unit the floors are expressed in.
 *
 *  A direction (ACCUMULATING or DECLINING) needs the SAME evidence either
 *  way: a slope past its floor AND either a low-noise series or a slope
 *  statistically distinguishable from flat (one-sided 95% t-test). The old
 *  gate demanded low noise only for improvement, so a noisy climb read
 *  "stable" while its mirror-image noisy decline read "declining". With no
 *  real direction, a noisy series is STABLE_VARIATION; a quiet flat one
 *  resolves to TOO_EARLY_TO_JUDGE inside the post-load-change grace window,
 *  BUILDING_BASELINE past grace but short of the plateau floor, and only
 *  then POSSIBLE_PLATEAU. Mixed-load / not-evaluable points (`total ==
 *  null`) are excluded before regression ever runs — never a NaN. */
export function computeCurrentLoadProgress(
  cyclePoints: readonly RepresentativePoint[],
  metricKind: ProgressMetricKind,
  policy: ExerciseProgressionPolicy,
): { state: CurrentLoadProgressState; n: number; slope: number | null; residualSpread: number | null } {
  const withTotal = cyclePoints.filter(p => p.total != null)
  if (withTotal.length < 3) return { state: 'INSUFFICIENT_HISTORY', n: withTotal.length, slope: null, residualSpread: null }

  // Segment to the dominant (or latest-matching) comparable set count before
  // regressing — a set-count-incompatible point is excluded here rather
  // than silently blended into the same series (§3 — a 2-set session must
  // never be regressed against a 3-set one).
  const targetSetCount = dominantSetCount(withTotal)
  const usable = withTotal.filter(p => p.comparableSetCount === targetSetCount)
  if (usable.length < 3) return { state: 'INSUFFICIENT_HISTORY', n: usable.length, slope: null, residualSpread: null }

  const series = usable.map(p => p.total as number)
  const { slope, residualSpread } = linearFit(series)
  const { graceSessions, minSessions } = policy.plateau
  const floors = currentLoadFloors(metricKind, series, policy)
  const significant = residualSpread <= floors.noise || slopeTStatistic(slope, residualSpread, series.length) >= tCriticalOneSided95(series.length)

  let state: CurrentLoadProgressState
  if (slope >= floors.accumulation && significant) state = 'ACCUMULATING'
  else if (slope <= -floors.decline && significant) state = 'DECLINING'
  else if (residualSpread > floors.noise) state = 'STABLE_VARIATION'
  else if (usable.length <= graceSessions) state = 'TOO_EARLY_TO_JUDGE'
  else if (usable.length < minSessions) state = 'BUILDING_BASELINE'
  else state = 'POSSIBLE_PLATEAU'

  return { state, n: usable.length, slope, residualSpread }
}

/** A configurable recent window (default 8), separate from all-history
 *  event detection — an earlier successful load cycle outside the window
 *  is not visible here, but it is never erased from `events.ts`'s PR
 *  detection, which always scans the full history.
 *
 *  Reuses the SAME `isCleanProgression` contract the per-pair read uses
 *  (`comparability.ts`) — this function never independently classifies
 *  progression from a raw total comparison. A pair with a comparable-set-
 *  count mismatch is skipped entirely (never enters positive OR negative
 *  tallying), matching the rule that a set-count mismatch never enters
 *  trend regression.
 *
 *  §5: `n` and the returned `weekSpan` are calculated from the EVALUABLE
 *  points actually used — never the raw window slice's length. A point
 *  with no representative value at all (e.g. a `weight_duration` composite
 *  session) is excluded BEFORE the `< 3` sufficiency check, so a window
 *  entirely made of unusable sessions correctly reads INSUFFICIENT_HISTORY
 *  (feeding a Limited progress-evidence read) instead of silently reporting
 *  FLAT_NORMAL_VARIATION with a raw session count that implies real data
 *  backs it. Evaluability is metric-aware: `weightKg` for a weight-based
 *  metric, `metricValue` otherwise — a plain reps/duration/distance point
 *  legitimately has `weightKg: null` and must not be excluded for that.
 *
 *  §4: both tallies use `isQualifiedForPositiveSignal` (metricStrategy.ts)
 *  before crediting a "positive" — the SAME shared qualification pair
 *  evaluation and the progression streak use — so a load increase (or a
 *  raw clean quantity increase) into an incomplete/mixed/not-evaluable/
 *  below-minimum session is never counted as trend evidence. */
export function computeRecentProgressTrend(
  points: readonly RepresentativePoint[],
  metricKind: ProgressMetricKind,
  policy: ExerciseProgressionPolicy,
  expectation: ExpectationRange,
): { state: RecentProgressTrendState; n: number; weekSpan: number; positive: number; negative: number } {
  const windowedRaw = points.slice(-policy.recentWindowSessions)
  const windowed = windowedRaw.filter(p => isWeightBasedMetric(metricKind) ? p.weightKg != null : p.metricValue != null)
  const weekSpan = windowed.length >= 2 ? Math.round(daysBetweenDates(windowed[0].date, windowed[windowed.length - 1].date) / 7) : 0
  if (windowed.length < 3) return { state: 'INSUFFICIENT_HISTORY', n: windowed.length, weekSpan, positive: 0, negative: 0 }

  const cyclesInWindow = buildLoadCycles(windowed)
  let positive = 0, negative = 0

  for (let i = 1; i < cyclesInWindow.length; i++) {
    const prevW = cyclesInWindow[i - 1].weightKg, currW = cyclesInWindow[i].weightKg
    if (prevW == null || currW == null) continue
    const direction = isPositiveLoadChange(metricKind, prevW, currW)
    if (direction === true) {
      const currFirstPoint = cyclesInWindow[i].points[0]
      if (isQualifiedForPositiveSignal(currFirstPoint, expectation, metricKind)) positive++
    } else if (direction === false) negative++
  }

  for (const cycle of cyclesInWindow) {
    for (let i = 1; i < cycle.points.length; i++) {
      const prev = cycle.points[i - 1], curr = cycle.points[i]
      if (prev.total == null || curr.total == null) continue
      if (prev.comparableSetCount !== curr.comparableSetCount) continue // a set-count mismatch never enters trend regression
      if (isCleanProgression(prev.sets, curr.sets, metricKind) && isQualifiedForPositiveSignal(curr, expectation, metricKind)) {
        positive++
        continue
      }
      // The quantity axis (reps/duration/distance) is always "more is
      // better" — see isCleanProgression's own note; never inverted here.
      const declinedBy = prev.total - curr.total
      if (declinedBy >= meaningfulDeclineReps(Math.abs(prev.total), policy)) negative++
    }
  }

  let state: RecentProgressTrendState
  if (positive === 0 && negative === 0) state = 'FLAT_NORMAL_VARIATION'
  else if (negative > 0 && negative >= positive) state = 'REGRESSION_RISK'
  else state = 'PROGRESSING'
  return { state, n: windowed.length, weekSpan, positive, negative }
}
