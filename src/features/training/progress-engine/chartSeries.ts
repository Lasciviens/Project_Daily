// Progress engine — the per-session series one exercise's trend chart draws.
// Pure. Built from the engine's own canonical sessions and representative
// points, so the chart shows exactly the numbers the decision table judged
// (the retired chart path used a second, all-history best-e1RM calculation).

import type { CanonicalExerciseSession, ProgressMetricKind } from './types'
import { buildRepresentativePoints } from './trend'
import { isWeightBasedMetric, sessionBestE1rm } from './metricStrategy'
import { formatSessionSets } from './format'

export interface ExerciseChartRow {
  /** The workout id — a stable key; two sessions can share a date. */
  key: string
  date: string
  /** Local-midnight epoch ms (+3 h per extra session on the same day), for a
   *  time-proportional x axis: a six-week break looks like one. */
  ts: number
  workoutTitle: string | null
  /** The metric's own "how hard" value: the working load for a weight-based
   *  metric (the top set's load for a top-set+backoff session), otherwise
   *  top-set reps / seconds / metres. */
  primary: number | null
  /** Best estimated 1RM this session — est1rm-kind exercises only. */
  e1rm: number | null
  /** Σ of the metric's own quantity over the comparable working sets. */
  total: number | null
  /** Σ weight × reps over every non-warm-up set — weight-based kinds only. */
  volume: number | null
  /** The primary value moved since the previous session (a load change). */
  loadChanged: boolean
  setsLabel: string
}

export function buildExerciseChartRows(sessions: readonly CanonicalExerciseSession[], metricKind: ProgressMetricKind): ExerciseChartRow[] {
  const points = buildRepresentativePoints(sessions, metricKind)
  const weightBased = isWeightBasedMetric(metricKind)
  const sameDayIndex = new Map<string, number>()
  let previousPrimary: number | null = null
  return sessions.map((s, i) => {
    const p = points[i]
    const primary = weightBased ? p.weightKg : p.metricValue
    const n = sameDayIndex.get(s.date) ?? 0
    sameDayIndex.set(s.date, n + 1)
    let volume: number | null = null
    if (metricKind === 'est1rm' || metricKind === 'addedWeight') {
      for (const set of s.allSets) if (set.weightKg != null && set.reps != null) volume = (volume ?? 0) + set.weightKg * set.reps
      if (volume != null) volume = Math.round(volume)
    }
    const loadChanged = weightBased && primary != null && previousPrimary != null && primary !== previousPrimary
    if (primary != null) previousPrimary = primary
    return {
      key: s.workoutId,
      date: s.date,
      ts: new Date(s.date + 'T00:00:00').getTime() + n * 3 * 3_600_000,
      workoutTitle: s.workoutTitle,
      primary,
      e1rm: metricKind === 'est1rm' ? sessionBestE1rm(s.comparableWorkingSets) : null,
      total: p.total,
      volume,
      loadChanged,
      setsLabel: formatSessionSets(s.allSets, metricKind, { rpe: true }),
    }
  })
}
