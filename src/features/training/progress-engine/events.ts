// Progress engine — deterministic, all-history achievement detection.
// Never windowed (see trend.ts for the separate, windowed trend reads):
// an earlier successful load cycle must never lose its PR just because it
// falls outside the recent-trend window.

import type { CanonicalExerciseSession, ProgressEvent, ExpectationRange, ExerciseProgressionPolicy, ProgressMetricKind } from './types'
import type { RepresentativePoint } from './trend'
import { isPositiveLoadChange } from './policies'
import { isWeightBasedMetric, isCleanProgression, metricValueOf, selectRepresentativeSet } from './metricStrategy'

export function detectProgressEvents(
  points: readonly RepresentativePoint[],
  latestIndex: number,
  metricKind: ProgressMetricKind,
  latestSession: CanonicalExerciseSession,
  expectation: ExpectationRange,
  policy: ExerciseProgressionPolicy,
): ProgressEvent[] {
  const prior = points.slice(0, latestIndex)
  const latest = points[latestIndex]
  const events: ProgressEvent[] = []
  const weightBased = isWeightBasedMetric(metricKind)

  // LOAD_PR — the all-time extreme for this metric's positive direction
  // (accounts for the assisted-weight inversion via isPositiveLoadChange).
  // Weight-based metrics compare the raw representative weight; a metric
  // with no weight axis (reps/duration/distance) compares its own derived
  // value instead — a reps-only exercise still deserves a "best ever"
  // event, just not one framed around kilograms.
  const primaryOf = (p: RepresentativePoint) => weightBased ? p.weightKg : p.metricValue
  const latestPrimary = primaryOf(latest)
  if (latestPrimary != null) {
    const priorValues = prior.map(primaryOf).filter((v): v is number => v != null)
    const priorExtreme = priorValues.length
      ? (isWeightBasedMetric(metricKind) && metricKind === 'assistedWeight' ? Math.min(...priorValues) : Math.max(...priorValues))
      : null
    const isNewExtreme = priorExtreme == null || isPositiveLoadChange(metricKind, priorExtreme, latestPrimary) === true
    if (isNewExtreme && (priorExtreme == null || latestPrimary !== priorExtreme)) {
      events.push({ code: 'LOAD_PR', emphasis: 'primary', values: { value: latestPrimary, previousBest: priorExtreme } })
    }
  }

  // REP_PR_AT_LOAD — the representative set's own reps beat every prior
  // representative set's reps AT THE EXACT SAME LOAD (never a raw
  // cross-load comparison, and never gated on matching set count the way
  // TOTAL_REPS_PR_AT_LOAD is — this is about the single best set, not the
  // session total). `latestBest` is the actual BEST eligible set at that
  // exact load (highest reps among candidates), never merely the FIRST
  // matching set in set order — a session logging e.g. 60x6 then 60x9 at
  // the same load must credit the 9-rep set, not whichever came first.
  if (latest.weightKg != null && latestSession.comparableWorkingSets.length > 0) {
    const candidatesAtLoad = latestSession.comparableWorkingSets.filter(s =>
      (weightBased ? s.weightKg === latest.weightKg : true) && metricValueOf(s, metricKind) != null && s.reps != null,
    )
    const latestBest = candidatesAtLoad.length > 0
      ? candidatesAtLoad.reduce((best, s) => (s.reps as number) > (best.reps as number) ? s : best)
      : null
    if (latestBest?.reps != null) {
      const sameLoadPriorReps = prior
        .filter(p => p.weightKg === latest.weightKg)
        .map(p => p.sets.map(s => s.reps).filter((r): r is number => r != null))
        .flat()
      const priorMaxReps = sameLoadPriorReps.length ? Math.max(...sameLoadPriorReps) : null
      if (sameLoadPriorReps.length > 0 && latestBest.reps > (priorMaxReps as number)) {
        events.push({ code: 'REP_PR_AT_LOAD', emphasis: 'primary', values: { loadKg: latest.weightKg, reps: latestBest.reps, previousBest: priorMaxReps } })
      }
    }
  }

  // TOTAL_REPS_PR_AT_LOAD — requires the SAME load AND the SAME comparable
  // set count as at least one prior session (never a raw cross-load/cross-
  // count comparison — a missing/extra set never enters this).
  if (latest.total != null && latest.weightKg != null) {
    const sameLoadPriorTotals = prior
      .filter(p => p.weightKg === latest.weightKg && p.total != null && p.comparableSetCount === latest.comparableSetCount)
      .map(p => p.total as number)
    const priorMaxTotal = sameLoadPriorTotals.length ? Math.max(...sameLoadPriorTotals) : null
    if (sameLoadPriorTotals.length > 0 && (priorMaxTotal == null || latest.total > priorMaxTotal)) {
      events.push({ code: 'TOTAL_REPS_PR_AT_LOAD', emphasis: 'primary', values: { loadKg: latest.weightKg, total: latest.total, previousBest: priorMaxTotal } })
    }
  }

  // TARGET_COMPLETED — requires the EXACT prescribed set count (never a
  // partial/backoff/mixed session) with valid reps at/above the top of
  // range on every one of those prescribed working sets.
  if (
    expectation.repMax != null
    && latestSession.loadStructure === 'uniform_working_load'
    && latestSession.comparableWorkingSets.length === expectation.targetSets
    && latestSession.comparableWorkingSets.length > 0
    && latestSession.comparableWorkingSets.every(s => s.reps != null && s.reps >= (expectation.repMax as number))
  ) {
    events.push({ code: 'TARGET_COMPLETED', emphasis: 'primary', values: { repMax: expectation.repMax, targetSets: expectation.targetSets } })
  }

  // PROGRESSION_STREAK — N consecutive comparable-pair transitions that
  // each independently qualify as forward motion (a load increase in the
  // metric's own positive direction, or a clean progression per the shared
  // contract). `policy.progressionStreakMinLength` is a documented product
  // heuristic (default 3), not a scientific threshold.
  const streak = computeProgressionStreak(points, latestIndex, metricKind)
  if (streak >= policy.progressionStreakMinLength) {
    events.push({ code: 'PROGRESSION_STREAK', emphasis: 'primary', values: { streakLength: streak } })
  }

  return events
}

/** A streak link only counts within a comparable, stable-load context: a
 *  mixed-load session on either side of the pair breaks the streak outright
 *  (its own weightKg/total are already null, but its raw `sets` could still
 *  slip past `isCleanProgression` undetected without this explicit guard —
 *  a mixed session's sets don't share one clean load shape, so "reps went
 *  up" there proves nothing about real progression). A comparable-set-count
 *  mismatch is rejected too, matching the same rule used everywhere else in
 *  this engine (a missing/extra set never feeds a positive read). */
function computeProgressionStreak(points: readonly RepresentativePoint[], latestIndex: number, metricKind: ProgressMetricKind): number {
  let streak = 0
  for (let i = latestIndex; i > 0; i--) {
    const prev = points[i - 1], curr = points[i]
    if (prev.loadStructure === 'mixed_load' || curr.loadStructure === 'mixed_load') break
    const loadUp = prev.weightKg != null && curr.weightKg != null && isPositiveLoadChange(metricKind, prev.weightKg, curr.weightKg) === true
    const cleanProgression = prev.comparableSetCount === curr.comparableSetCount && isCleanProgression(prev.sets, curr.sets, metricKind)
    if (loadUp || cleanProgression) streak++
    else break
  }
  return streak
}

/** ESTIMATED_STRENGTH_PR needs the actual per-session best-set e1RM series,
 *  which the representative-point series doesn't carry for non-est1rm
 *  metrics — computed separately here from the real sessions so est1RM's
 *  12-rep eligibility ceiling is respected exactly once, in one place.
 *
 *  `e1rmOf` selects the set with the HIGHEST actual e1RM VALUE among a
 *  session's eligible sets — never "whichever set has the most reps", which
 *  is a different (and often wrong) ordering: 60kg x8 has a materially
 *  higher e1RM (~76kg) than 45kg x12 (~63kg) despite fewer reps.
 *  `selectRepresentativeSet` is called with 'uniform_working_load' rather
 *  than the session's own `loadStructure` specifically to bypass the
 *  top-set-and-backoff role-lock: PR detection cares about the single best
 *  e1RM logged this session, regardless of which set "role" produced it. */
export function detectEstimatedStrengthPr(
  sessions: readonly CanonicalExerciseSession[],
  latestIndex: number,
  metricKind: ProgressMetricKind,
): ProgressEvent | null {
  if (metricKind !== 'est1rm') return null
  const e1rmOf = (s: CanonicalExerciseSession) => {
    const best = selectRepresentativeSet(s.comparableWorkingSets, 'uniform_working_load', 'est1rm')
    return metricValueOf(best, 'est1rm')
  }
  const prior = sessions.slice(0, latestIndex).map(e1rmOf).filter((v): v is number => v != null)
  const latest = e1rmOf(sessions[latestIndex])
  const priorMax = prior.length ? Math.max(...prior) : null
  if (latest != null && (priorMax == null || latest > priorMax)) {
    return { code: 'ESTIMATED_STRENGTH_PR', emphasis: 'secondary', values: { e1rmKg: latest, previousBest: priorMax } }
  }
  return null
}
