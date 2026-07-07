// Pure aggregation functions over raw health_metrics points — collapses
// point-in-time rows (one per incoming sample, any source) into daily
// numbers for rings/summary cards/charts. Kept separate from healthApi.ts
// (which only fetches) so these are trivially unit-testable without a DB.
import { getAggregationType } from './healthMetrics'
import type { HealthMetric } from './api/healthApi'

function qtyOf(point: HealthMetric): number | null {
  const v = point.value?.qty
  return typeof v === 'number' ? v : null
}

function groupByDate(points: HealthMetric[]): Map<string, HealthMetric[]> {
  const byDate = new Map<string, HealthMetric[]>()
  for (const p of points) {
    const arr = byDate.get(p.date)
    if (arr) arr.push(p)
    else byDate.set(p.date, [p])
  }
  return byDate
}

// Collapses a group of points (any source, all merged) into a single number
// per the metric's aggregation type. Source is deliberately ignored — the
// same metric can arrive under differing source strings within one day
// (e.g. a compound "Watch|Phone" string once a second data provider joins
// partway through the day); the daily total should read as one number.
function aggregateGroup(points: HealthMetric[], metricName: string): number | null {
  const aggType = getAggregationType(metricName)
  const qtys = points.map(qtyOf).filter((v): v is number => v != null)
  if (aggType === 'sum') return qtys.length ? qtys.reduce((a, b) => a + b, 0) : null
  if (aggType === 'average') return qtys.length ? qtys.reduce((a, b) => a + b, 0) / qtys.length : null
  if (aggType === 'latest') {
    const sorted = [...points].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    for (let i = sorted.length - 1; i >= 0; i--) {
      const q = qtyOf(sorted[i])
      if (q != null) return q
    }
    return null
  }
  // 'minmaxavg' (heart_rate) and 'sleep' (sleep_analysis) have their own
  // shape-specific merges below — this generic path shouldn't be called for
  // them, but average-of-qty is a harmless fallback if it ever is.
  return qtys.length ? qtys.reduce((a, b) => a + b, 0) / qtys.length : null
}

export interface DailyValue { date: string; value: number }

// One number per day for sum/average/latest-type metrics.
export function computeDailySeries(metricName: string, points: HealthMetric[]): DailyValue[] {
  const byDate = groupByDate(points)
  const result: DailyValue[] = []
  for (const [date, pts] of byDate) {
    const value = aggregateGroup(pts, metricName)
    if (value != null) result.push({ date, value })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

export interface HourlyValue { hour: number; label: string; value: number }

// One number per hour-of-day (0-23) for a single day's points — used by the
// Steps/Energy sections' hourly bar charts. Uses the browser's local timezone
// to bucket (recorded_at is an absolute instant either way).
export function computeHourlyBuckets(metricName: string, points: HealthMetric[]): HourlyValue[] {
  const byHour = new Map<number, HealthMetric[]>()
  for (const p of points) {
    const h = new Date(p.recorded_at).getHours()
    const arr = byHour.get(h)
    if (arr) arr.push(p)
    else byHour.set(h, [p])
  }
  return Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: `${String(h).padStart(2, '0')}:00`,
    value: Math.round((aggregateGroup(byHour.get(h) ?? [], metricName) ?? 0) * 100) / 100,
  }))
}

export interface DailyRange { date: string; min: number; max: number; avg: number }

// heart_rate-shaped points ({Min,Avg,Max} per point) — a real day range needs
// the min of all mins / max of all maxes, not just the last window's numbers.
export function computeHeartRateDailySeries(points: HealthMetric[]): DailyRange[] {
  const byDate = groupByDate(points)
  const result: DailyRange[] = []
  for (const [date, pts] of byDate) {
    const mins = pts.map(p => p.value?.Min).filter((v): v is number => typeof v === 'number')
    const maxs = pts.map(p => p.value?.Max).filter((v): v is number => typeof v === 'number')
    const avgs = pts.map(p => p.value?.Avg).filter((v): v is number => typeof v === 'number')
    if (!mins.length && !maxs.length && !avgs.length) continue
    result.push({
      date,
      min: mins.length ? Math.min(...mins) : 0,
      max: maxs.length ? Math.max(...maxs) : 0,
      avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0,
    })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

export interface SleepSummary { date: string; core: number; rem: number; deep: number; awake: number; total: number }

const SLEEP_STAGE_KEYS = ['Core', 'REM', 'Deep', 'Awake', 'Asleep'] as const

// sleep_analysis arrives in two shapes depending on Health Auto Export's
// "Summarize" setting: pre-aggregated (one point/day with
// core/rem/deep/awake/totalSleep fields already computed) or raw per-segment
// points ({value:'Core'|'Deep'|'REM'|'Awake'|'Asleep', qty: hours, start, end}
// — one row per sleep-stage transition). Handle both.
export function computeSleepSummary(points: HealthMetric[]): SleepSummary[] {
  const byDate = groupByDate(points)
  const result: SleepSummary[] = []
  for (const [date, pts] of byDate) {
    const preAggregated = pts.filter(p => typeof p.value?.totalSleep === 'number')
    if (preAggregated.length > 0) {
      const latest = [...preAggregated].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)).pop()!
      const v = latest.value
      const core = v.core ?? 0, rem = v.rem ?? 0, deep = v.deep ?? 0, awake = v.awake ?? 0
      result.push({ date, core, rem, deep, awake, total: v.totalSleep ?? (core + rem + deep) })
      continue
    }

    const stageSum: Record<string, number> = { Core: 0, REM: 0, Deep: 0, Awake: 0, Asleep: 0 }
    for (const p of pts) {
      const stage = p.value?.value
      const qty = p.value?.qty
      if (typeof stage === 'string' && typeof qty === 'number' && SLEEP_STAGE_KEYS.includes(stage as typeof SLEEP_STAGE_KEYS[number])) {
        stageSum[stage] += qty
      }
    }
    const core = stageSum.Core, rem = stageSum.REM, deep = stageSum.Deep, awake = stageSum.Awake
    const total = core + rem + deep + stageSum.Asleep
    if (total > 0 || awake > 0) result.push({ date, core, rem, deep, awake, total })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}
