// Pure aggregation functions over raw health_metrics points — collapses
// point-in-time rows (one per incoming sample, any source) into daily
// numbers for rings/summary cards/charts. Kept separate from healthApi.ts
// (which only fetches) so these are trivially unit-testable without a DB.
import { getAggregationType } from './healthMetrics'
import { todayStr, shiftDateStr } from '../../shared/utils/dateUtils'
import type { HealthMetric } from './api/healthApi'

// Health Auto Export can export active/basal energy in kJ instead of kcal
// depending on the device's locale/unit settings, even though every card in
// the Health tab labels the value "kcal" — convert so the label is honest.
const KJ_PER_KCAL = 4.184
const ENERGY_METRICS = new Set(['active_energy', 'basal_energy_burned'])

function qtyOf(point: HealthMetric, metricName?: string): number | null {
  const v = point.value?.qty
  if (typeof v !== 'number') return null
  if (metricName && ENERGY_METRICS.has(metricName) && point.unit?.toLowerCase().includes('kj')) {
    return v / KJ_PER_KCAL
  }
  return v
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
  const qtys = points.map(p => qtyOf(p, metricName)).filter((v): v is number => v != null)
  if (aggType === 'sum') return qtys.length ? qtys.reduce((a, b) => a + b, 0) : null
  if (aggType === 'average') return qtys.length ? qtys.reduce((a, b) => a + b, 0) / qtys.length : null
  if (aggType === 'latest') {
    const sorted = [...points].sort((a, b) => a.recorded_at.localeCompare(b.recorded_at))
    for (let i = sorted.length - 1; i >= 0; i--) {
      const q = qtyOf(sorted[i], metricName)
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

function rangeFromPoints(pts: HealthMetric[]): { min: number; max: number; avg: number } | null {
  const mins = pts.map(p => p.value?.Min).filter((v): v is number => typeof v === 'number')
  const maxs = pts.map(p => p.value?.Max).filter((v): v is number => typeof v === 'number')
  const avgs = pts.map(p => p.value?.Avg).filter((v): v is number => typeof v === 'number')
  if (!mins.length && !maxs.length && !avgs.length) return null
  return {
    min: mins.length ? Math.min(...mins) : 0,
    max: maxs.length ? Math.max(...maxs) : 0,
    avg: avgs.length ? avgs.reduce((a, b) => a + b, 0) / avgs.length : 0,
  }
}

// heart_rate-shaped points ({Min,Avg,Max} per point) — a real day range needs
// the min of all mins / max of all maxes, not just the last window's numbers.
export function computeHeartRateDailySeries(points: HealthMetric[]): DailyRange[] {
  const byDate = groupByDate(points)
  const result: DailyRange[] = []
  for (const [date, pts] of byDate) {
    const range = rangeFromPoints(pts)
    if (range) result.push({ date, ...range })
  }
  return result.sort((a, b) => a.date.localeCompare(b.date))
}

export interface HourlyRange { hour: number; label: string; min: number; max: number; avg: number }

// Same as computeHeartRateDailySeries but bucketed by hour-of-day, for a
// single day's "Day" view.
export function computeHeartRateHourlySeries(points: HealthMetric[]): HourlyRange[] {
  const byHour = new Map<number, HealthMetric[]>()
  for (const p of points) {
    const h = new Date(p.recorded_at).getHours()
    const arr = byHour.get(h)
    if (arr) arr.push(p)
    else byHour.set(h, [p])
  }
  return Array.from({ length: 24 }, (_, h) => {
    const range = rangeFromPoints(byHour.get(h) ?? []) ?? { min: 0, max: 0, avg: 0 }
    return { hour: h, label: `${String(h).padStart(2, '0')}:00`, ...range }
  })
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

// Average share of Deep/Core/REM (normalized to sum to 1) across nights with
// real stage data — used to back-fill a manually-logged night (the user only
// enters a total when the Watch wasn't worn to sleep) with a realistic
// breakdown instead of leaving it as one undifferentiated bucket. Awake time
// is deliberately excluded from the split (a manual entry has no way to know
// how long you were briefly awake, so it's left at 0 rather than guessed).
export function estimateSleepStageProportions(summaries: SleepSummary[]): { deep: number; core: number; rem: number } | null {
  const withStages = summaries
    .map(s => ({ ...s, stageTotal: s.deep + s.core + s.rem }))
    .filter(s => s.stageTotal > 0)
  if (!withStages.length) return null
  const fractions = withStages.map(s => ({ deep: s.deep / s.stageTotal, core: s.core / s.stageTotal, rem: s.rem / s.stageTotal }))
  const avgOf = (key: 'deep' | 'core' | 'rem') => fractions.reduce((sum, f) => sum + f[key], 0) / fractions.length
  return { deep: avgOf('deep'), core: avgOf('core'), rem: avgOf('rem') }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// How many preceding days computeBasalEnergyDailySeries looks at for its
// per-hour reference — callers must fetch this many extra buffer days
// before the earliest date they pass in.
export const BASAL_REFERENCE_WINDOW_DAYS = 7

// Basal (resting) energy is roughly constant hour-to-hour, so a gap from the
// Watch being off (charging, not worn, or just removed mid-hour) shouldn't
// read as zero/partial for that stretch. For every hour of the target day,
// if the Watch-measured amount is below what that SAME hour-of-day usually
// contributes, top it up to that floor instead of leaving the raw (possibly
// partial) reading. The floor is the MEDIAN of that hour across the last
// `BASAL_REFERENCE_WINDOW_DAYS` days (only days/hours that have any data) —
// median rather than a single day's average so one unusually high/low
// reference day can't skew the floor, and per-hour rather than one flat
// number so a naturally-lower-basal hour (e.g. deep sleep) isn't over-
// corrected using a naturally-higher hour's rate. `allPoints` must include
// that many extra buffer days before the earliest date in `dates`.
export function computeBasalEnergyDailySeries(allPoints: HealthMetric[], dates: string[]): DailyValue[] {
  const byDate = groupByDate(allPoints)
  const today = todayStr()
  const currentHour = new Date().getHours()

  const hourlyCache = new Map<string, number[]>()
  function hourlyFor(date: string): number[] {
    let hourly = hourlyCache.get(date)
    if (!hourly) {
      hourly = computeHourlyBuckets('basal_energy_burned', byDate.get(date) ?? []).map(h => h.value)
      hourlyCache.set(date, hourly)
    }
    return hourly
  }

  const result: DailyValue[] = []
  for (const date of dates) {
    const hourly = hourlyFor(date)
    // Don't project into hours of today that haven't happened yet.
    const maxHour = date === today ? currentHour : 23

    const referenceByHour = Array.from({ length: 24 }, (_, h) => {
      const samples: number[] = []
      for (let d = 1; d <= BASAL_REFERENCE_WINDOW_DAYS; d++) {
        const v = hourlyFor(shiftDateStr(date, -d))[h]
        if (v > 0) samples.push(v)
      }
      return samples.length ? median(samples) : null
    })

    let total = 0
    for (let h = 0; h <= maxHour; h++) {
      const ref = referenceByHour[h]
      total += ref != null ? Math.max(hourly[h], ref) : hourly[h]
    }
    if (total > 0 || (byDate.get(date) ?? []).length) result.push({ date, value: Math.round(total * 10) / 10 })
  }
  return result
}
