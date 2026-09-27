// "Big changes this week" — a plain per-exercise change detector, shipped
// INSTEAD OF an acute:chronic workload ratio (ACWR): ACWR's injury-prediction
// evidence is team-sport running/GPS load, it has drawn sustained statistical
// criticism (mathematical coupling between the acute and chronic windows,
// unstable "sweet spot" thresholds), and lifting tonnage conflates load and
// reps. This only ever asks "did this go up sharply versus your OWN last
// month" — never "is this risky". Pure; scores each set through the SAME
// metric strategies the progress engine uses (direction-aware: less
// assistance is the improvement), so an assisted exercise can flag too.

import type { ProgressSetRow, ProgressTemplateRow, ProgressMetricKind } from '../progressAggregate'
import { metricKindForExerciseType, mondayOf } from '../progressAggregate'
import { metricValueOf, higherIsBetterFor } from './metricStrategy'
import type { CanonicalSet } from './types'

export type WeeklyChangeKind = 'new' | 'load' | 'volume'
export interface WeeklyChangeFlag {
  templateId: string
  kind: WeeklyChangeKind
  metricKind?: ProgressMetricKind
  /** Present for 'load'/'volume' — the IMPROVEMENT as a fraction of the prior
   *  median (e.g. 0.12 = 12% better). For assistance this is the share of
   *  assistance removed. */
  pct?: number
  thisWeekValue?: number
  priorMedian?: number
}

const LOAD_JUMP_PCT = 0.10
const SET_JUMP_PCT = 0.30
const MIN_PRIOR_WEEKS = 3
const NOVEL_GAP_WEEKS = 8

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function weeksBetween(a: string, b: string): number {
  return Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / (7 * 86_400_000))
}

function asCanonical(s: ProgressSetRow): CanonicalSet {
  return {
    order: s.set_index ?? 0, kind: s.set_type === 'dropset' ? 'dropset' : s.set_type === 'failure' ? 'failure' : 'normal',
    weightKg: s.weight_kg, reps: s.reps, durationSeconds: s.duration_seconds, distanceMeters: s.distance_meters,
  }
}

/** For the exercises trained in the week containing `anchorDate` (a LOCAL
 *  date): this week's best set (by the exercise's own metric) and working-set
 *  count against the MEDIAN of up to the 4 preceding weeks it appears in
 *  (median, so one deload week can't manufacture a flag on the return). An
 *  exercise with no appearance in the last 8 weeks (or ever) is flagged 'new'
 *  with no threshold. */
export function computeWeeklyChangeFlags(
  sets: ProgressSetRow[],
  templates: ProgressTemplateRow[],
  anchorDate: string,
): WeeklyChangeFlag[] {
  const typeById = new Map(templates.map(t => [t.id, t.type]))
  const currentWeek = mondayOf(anchorDate)

  interface WeekEntry { best: number | null; setCount: number }
  const weeklyByTemplate = new Map<string, Map<string, WeekEntry>>()
  const kindByTemplate = new Map<string, ProgressMetricKind>()

  for (const s of sets) {
    if (s.set_type === 'warmup') continue
    const type = typeById.get(s.exercise_template_id)
    if (!type) continue
    const metricKind = metricKindForExerciseType(type)
    kindByTemplate.set(s.exercise_template_id, metricKind)
    const week = mondayOf(s.date)

    let byWeek = weeklyByTemplate.get(s.exercise_template_id)
    if (!byWeek) { byWeek = new Map(); weeklyByTemplate.set(s.exercise_template_id, byWeek) }
    let entry = byWeek.get(week)
    if (!entry) { entry = { best: null, setCount: 0 }; byWeek.set(week, entry) }
    entry.setCount++

    const value = metricValueOf(asCanonical(s), metricKind)
    if (value == null) continue
    const better = entry.best == null || (higherIsBetterFor(metricKind) ? value > entry.best : value < entry.best)
    if (better) entry.best = value
  }

  const out: WeeklyChangeFlag[] = []
  for (const [templateId, byWeek] of weeklyByTemplate) {
    const thisWeek = byWeek.get(currentWeek)
    if (!thisWeek) continue
    const metricKind = kindByTemplate.get(templateId) as ProgressMetricKind

    const priorWeekKeys = [...byWeek.keys()].filter(w => w < currentWeek).sort()
    const lastTrainedWeek = priorWeekKeys[priorWeekKeys.length - 1]
    if (!lastTrainedWeek || weeksBetween(lastTrainedWeek, currentWeek) >= NOVEL_GAP_WEEKS) {
      out.push({ templateId, kind: 'new', metricKind })
      continue
    }

    const window = priorWeekKeys.slice(-4)
    if (window.length < MIN_PRIOR_WEEKS) continue

    const priorBests = window.map(w => byWeek.get(w)!.best).filter((v): v is number => v != null)
    if (priorBests.length > 0 && thisWeek.best != null) {
      const medianBest = median(priorBests)
      if (medianBest > 0) {
        // Direction-aware, from absolute values: +12% load, or 25% less
        // assistance — both read as a 0.12 / 0.25 improvement.
        const pct = higherIsBetterFor(metricKind) ? thisWeek.best / medianBest - 1 : 1 - thisWeek.best / medianBest
        if (pct >= LOAD_JUMP_PCT) out.push({ templateId, kind: 'load', metricKind, pct, thisWeekValue: thisWeek.best, priorMedian: medianBest })
      }
    }

    const priorSetCounts = window.map(w => byWeek.get(w)!.setCount)
    const medianSets = median(priorSetCounts)
    if (medianSets > 0) {
      const pct = thisWeek.setCount / medianSets - 1
      if (pct >= SET_JUMP_PCT) out.push({ templateId, kind: 'volume', metricKind, pct, thisWeekValue: thisWeek.setCount, priorMedian: medianSets })
    }
  }

  return out
}
