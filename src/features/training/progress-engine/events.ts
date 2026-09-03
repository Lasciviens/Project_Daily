// Progress engine — deterministic, all-history achievement detection.
// Never windowed (see trend.ts for the separate, windowed trend reads):
// an earlier successful load cycle must never lose its PR just because it
// falls outside the recent-trend window.

import { est1RM } from '../progressAggregate'
import type { CanonicalExerciseSession, ProgressEvent, ExpectationRange } from './types'
import type { RepresentativePoint } from './trend'
import { isPositiveLoadChange } from './policies'

const EST_1RM_MAX_REPS = 12

function maxOrNull(values: readonly (number | null)[]): number | null {
  const real = values.filter((v): v is number => v != null)
  return real.length ? Math.max(...real) : null
}

export function detectProgressEvents(
  points: readonly RepresentativePoint[],
  latestIndex: number,
  metricKind: string,
  latestSession: CanonicalExerciseSession,
  expectation: ExpectationRange,
): ProgressEvent[] {
  const prior = points.slice(0, latestIndex)
  const latest = points[latestIndex]
  const events: ProgressEvent[] = []

  // LOAD_PR — the all-time extreme for this metric's positive direction
  // (accounts for the assisted-weight inversion via isPositiveLoadChange).
  if (latest.weightKg != null) {
    const priorExtreme = metricKind === 'assistedWeight'
      ? (() => { const vals = prior.map(p => p.weightKg).filter((v): v is number => v != null); return vals.length ? Math.min(...vals) : null })()
      : maxOrNull(prior.map(p => p.weightKg))
    const isNewExtreme = priorExtreme == null || isPositiveLoadChange(metricKind as never, priorExtreme, latest.weightKg) === true
    if (isNewExtreme && (priorExtreme == null || latest.weightKg !== priorExtreme)) {
      events.push({ code: 'LOAD_PR', emphasis: 'primary', values: { loadKg: latest.weightKg, previousBest: priorExtreme } })
    }
  }

  // ESTIMATED_STRENGTH_PR is detected separately by detectEstimatedStrengthPr
  // below, from the real sessions (it needs each session's own best-set
  // e1RM, which this representative-point series doesn't carry directly).

  // TOTAL_REPS_PR_AT_LOAD — requires the SAME load and the SAME comparable
  // set count as at least one prior session (never a raw cross-load/cross-
  // count comparison).
  if (latest.total != null && latest.weightKg != null) {
    const sameLoadPriorTotals = prior
      .filter(p => p.weightKg === latest.weightKg && p.total != null)
      .map(p => p.total as number)
    const priorMaxTotal = sameLoadPriorTotals.length ? Math.max(...sameLoadPriorTotals) : null
    if (sameLoadPriorTotals.length > 0 && (priorMaxTotal == null || latest.total > priorMaxTotal)) {
      events.push({ code: 'TOTAL_REPS_PR_AT_LOAD', emphasis: 'primary', values: { loadKg: latest.weightKg, total: latest.total, previousBest: priorMaxTotal } })
    }
  }

  // TARGET_COMPLETED — every comparable working set reached the top of the
  // configured range this session.
  if (expectation.repMax != null && latestSession.comparableWorkingSets.length > 0) {
    const allAtTop = latestSession.comparableWorkingSets.every(s => (s.reps ?? 0) >= (expectation.repMax as number))
    if (allAtTop) events.push({ code: 'TARGET_COMPLETED', emphasis: 'primary', values: { repMax: expectation.repMax } })
  }

  return events
}

/** ESTIMATED_STRENGTH_PR needs the actual per-session best-set e1RM series,
 *  which the representative-point series doesn't carry for non-est1rm
 *  metrics — computed separately here from the real sessions so est1RM's
 *  12-rep eligibility ceiling is respected exactly once, in one place. */
export function detectEstimatedStrengthPr(
  sessions: readonly CanonicalExerciseSession[],
  latestIndex: number,
  metricKind: string,
): ProgressEvent | null {
  if (metricKind !== 'est1rm') return null
  const e1rmOf = (s: CanonicalExerciseSession) => {
    const best = s.comparableWorkingSets.reduce((b, x) => (x.reps ?? 0) > (b?.reps ?? -1) ? x : b, s.comparableWorkingSets[0] ?? null)
    if (!best || best.weightKg == null || best.reps == null || best.reps > EST_1RM_MAX_REPS) return null
    return est1RM(best.weightKg, best.reps)
  }
  const prior = sessions.slice(0, latestIndex).map(e1rmOf).filter((v): v is number => v != null)
  const latest = e1rmOf(sessions[latestIndex])
  const priorMax = prior.length ? Math.max(...prior) : null
  if (latest != null && (priorMax == null || latest > priorMax)) {
    return { code: 'ESTIMATED_STRENGTH_PR', emphasis: 'secondary', values: { e1rmKg: latest, previousBest: priorMax } }
  }
  return null
}
