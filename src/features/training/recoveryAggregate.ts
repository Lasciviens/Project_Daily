// Pure aggregation for the Progress tab's Recovery panel — weekly sleep and
// resting-heart-rate trends, joined to the SAME Monday-week keys as
// progressAggregate.ts's tonnage trend (mondayOf) so all three lanes share
// one definition of "a week". Kept in its own file (not progressAggregate.ts)
// because it depends on Health-domain types (SleepSummary/DailyValue from
// healthAggregate.ts) rather than Hevy's — but stays just as import-free of
// runtime deps (only type-only imports), so it's testable the same way.
//
// Sports-scientist review (2026-08-31): ship this as three STACKED lanes on a
// shared X axis, never a dual-axis overlay — a dual axis lets two arbitrary
// scales be tuned until any two series look coupled, which is a causality
// claim made with a scale factor instead of words. Nothing here computes a
// composite "readiness" number; each lane is its own real measurement.
import { mondayOf } from './progressAggregate'
import type { SleepSummary, DailyValue } from './healthAggregate'

// A week needs at least this many tracked nights/days before it gets plotted
// — an average of 1-2 nights isn't a weekly figure, and a gap in the line is
// more honest than an imputed one.
const MIN_POINTS_PER_WEEK = 4

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface WeeklySleepPoint { weekStart: string; avgHours: number | null; nights: number }

/** Mean nightly sleep (hours asleep, awake excluded) per week — mean, not
 *  median: with only 5-7 points a week, a genuinely short night is signal
 *  that should pull the average down, not get discarded as an outlier. */
export function computeWeeklySleepTrend(summaries: SleepSummary[]): WeeklySleepPoint[] {
  const byWeek = new Map<string, number[]>()
  for (const s of summaries) {
    const wk = mondayOf(s.date)
    const arr = byWeek.get(wk) ?? []
    arr.push(s.total)
    byWeek.set(wk, arr)
  }
  return [...byWeek.entries()]
    .map(([weekStart, hours]) => ({
      weekStart,
      nights: hours.length,
      avgHours: hours.length >= MIN_POINTS_PER_WEEK
        ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
        : null,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}

export interface WeeklyRestingHRPoint { weekStart: string; medianBpm: number | null; days: number }

/** Weekly MEDIAN of daily resting heart rate — median rather than mean
 *  because a single bad reading shouldn't visibly move a 5-7-point week. */
export function computeWeeklyRestingHRTrend(daily: DailyValue[]): WeeklyRestingHRPoint[] {
  const byWeek = new Map<string, number[]>()
  for (const d of daily) {
    const wk = mondayOf(d.date)
    const arr = byWeek.get(wk) ?? []
    arr.push(d.value)
    byWeek.set(wk, arr)
  }
  return [...byWeek.entries()]
    .map(([weekStart, vals]) => ({
      weekStart,
      days: vals.length,
      medianBpm: vals.length >= MIN_POINTS_PER_WEEK ? Math.round(median(vals)) : null,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
}
