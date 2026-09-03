// Progress engine — the two trend axes, kept structurally separate per the
// approved contract: `recentProgressTrend` (a configurable recent window,
// preserving earlier successful load cycles) and `currentLoadProgress`
// (scoped to the CURRENT stable-load segment only). All-history PR/event
// detection lives in events.ts and is never windowed.

import type { CanonicalExerciseSession, ExerciseProgressionPolicy, RecentProgressTrendState, CurrentLoadProgressState } from './types'
import { totalComparableReps, bestComparableSet } from './normalize'

export interface RepresentativePoint {
  date: string
  loadStructure: CanonicalExerciseSession['loadStructure']
  weightKg: number | null
  total: number | null
}

export function buildRepresentativePoints(sessions: readonly CanonicalExerciseSession[], metricKind: string): RepresentativePoint[] {
  return sessions.map(s => ({
    date: s.date,
    loadStructure: s.loadStructure,
    weightKg: bestComparableSet(s, metricKind)?.weightKg ?? null,
    total: s.loadStructure === 'mixed_load' ? null : totalComparableReps(s),
  }))
}

export interface LoadCycle { weightKg: number | null; points: RepresentativePoint[] }

/** Partitions the ordered point series into maximal runs sharing one
 *  representative load. */
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
 *  total-rep increase counts regardless of magnitude, per computeRepDelta
 *  in comparability.ts). A documented product heuristic, not a scientific
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

/** Scoped to the CURRENT load cycle only. Mixed-load points (total=null)
 *  are excluded before regression ever runs — never a NaN in the domain
 *  model. `ACCUMULATING` requires a REAL positive slope (not merely >0 —
 *  gated by `accumulationSlopeFloor` so pure noise can never masquerade as
 *  progress); a flat, low-noise read resolves to `TOO_EARLY_TO_JUDGE`
 *  while still inside the post-load-change grace window, `BUILDING_BASELINE`
 *  once past grace but short of the plateau floor, and only then
 *  `POSSIBLE_PLATEAU`. */
export function computeCurrentLoadProgress(
  cyclePoints: readonly RepresentativePoint[],
  policy: ExerciseProgressionPolicy,
): { state: CurrentLoadProgressState; n: number; slope: number | null; residualSpread: number | null } {
  const usable = cyclePoints.filter(p => p.loadStructure !== 'mixed_load' && p.total != null)
  if (usable.length < 3) return { state: 'INSUFFICIENT_HISTORY', n: usable.length, slope: null, residualSpread: null }
  const { slope, residualSpread } = linearFit(usable.map(p => p.total as number))
  const { accumulationSlopeFloor, declineSlopeFloor, residualNoiseFloor, graceSessions, minSessions } = policy.plateau

  let state: CurrentLoadProgressState
  if (slope >= accumulationSlopeFloor && residualSpread <= residualNoiseFloor) state = 'ACCUMULATING'
  else if (slope <= -declineSlopeFloor) state = 'DECLINING'
  else if (residualSpread > residualNoiseFloor) state = 'STABLE_VARIATION'
  else if (usable.length <= graceSessions) state = 'TOO_EARLY_TO_JUDGE'
  else if (usable.length < minSessions) state = 'BUILDING_BASELINE'
  else state = 'POSSIBLE_PLATEAU'

  return { state, n: usable.length, slope, residualSpread }
}

/** A configurable recent window (default 8), separate from all-history
 *  event detection — an earlier successful load cycle outside the window
 *  is not visible here, but it is never erased from `events.ts`'s PR
 *  detection, which always scans the full history. Counts load-cycle
 *  advances plus clean within-cycle rep increases as positive signals, and
 *  load-cycle retreats plus meaningful within-cycle declines as negative —
 *  never a single unlimited-lifetime tally. */
export function computeRecentProgressTrend(
  points: readonly RepresentativePoint[],
  policy: ExerciseProgressionPolicy,
): { state: RecentProgressTrendState; n: number; positive: number; negative: number } {
  const windowed = points.slice(-policy.recentWindowSessions)
  if (windowed.length < 3) return { state: 'INSUFFICIENT_HISTORY', n: windowed.length, positive: 0, negative: 0 }

  const cyclesInWindow = buildLoadCycles(windowed)
  let positive = 0, negative = 0
  for (let i = 1; i < cyclesInWindow.length; i++) {
    const prevW = cyclesInWindow[i - 1].weightKg, currW = cyclesInWindow[i].weightKg
    if (prevW == null || currW == null) continue
    if (currW > prevW) positive++
    else if (currW < prevW) negative++
  }
  for (const cycle of cyclesInWindow) {
    if (cycle.points[0]?.loadStructure !== 'uniform_working_load') continue
    for (let i = 1; i < cycle.points.length; i++) {
      const prevTotal = cycle.points[i - 1].total, currTotal = cycle.points[i].total
      if (prevTotal == null || currTotal == null) continue
      if (currTotal > prevTotal) positive++
      else if (prevTotal - currTotal >= meaningfulDeclineReps(prevTotal, policy)) negative++
    }
  }

  let state: RecentProgressTrendState
  if (positive === 0 && negative === 0) state = 'FLAT_NORMAL_VARIATION'
  else if (negative > 0 && negative >= positive) state = 'REGRESSION_RISK'
  else state = 'PROGRESSING'
  return { state, n: windowed.length, positive, negative }
}
