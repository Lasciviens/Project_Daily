// Health → Body's "Weekly changes": one row per Monday–Sunday week, newest
// first — the week's average weight, body fat %, muscle % and the scale's body
// score, each with its change from the week before. Pure
// (scripts/verify-weekly-body-changes.cjs); the imports are pure modules too.
//
// What each column reads (the caller hands over one value per day):
//   weight  — the smart scale only (Apple Health, else its photo report; never
//             a hand-typed Hevy weight), bodyweight.scaleOnly.
//   fat     — body fat % from the scale in use only (currentDeviceSeries — two
//             scales read ~2 points apart).
//   muscle  — the photo report's muscle % (body_composition_reports.muscle_percent):
//             % of body weight, the only muscle figure stored. Apple Health has
//             lean mass (everything that isn't fat), which is not muscle.
//   score   — the photo report's own 0–100 body score, as the scale printed it.
//
// A change smaller than the measurement's noise is "steady" and never
// coloured: weight ±0.3 kg (day-to-day swings, bodyGoal.GOAL_NOISE), body fat
// ±0.6 points (Looney 2024, bodyGoal.MIN_FAT_PCT_CHANGE), muscle ±0.6 points
// (Looney's ~0.5 kg lean-mass noise is ~0.6 % of an 80 kg body), body score
// 1 point (the scale prints whole numbers). A real change is coloured by the
// phase in day_targets.goal: weight through bodyGoal.classifyRate (the same
// pace bands as Goal progress), body fat down / muscle up is good in every
// phase. The body score is the scale's own judgment and is shown, not judged.
import { classifyRate, GOAL_NOISE, MIN_FAT_PCT_CHANGE, type Phase, type RateStatus } from './goal/bodyGoal'
import { mondayOfIso } from './healthTrendStats'
import { addDaysIso, daysBetweenIso, type DayValue } from './healthWindowStats'

export type WeeklyMetric = 'weight' | 'fat' | 'muscle' | 'score'

export interface WeeklyMetricMeta {
  key: WeeklyMetric
  label: string
  unit: string
  decimals: number
  /** A change smaller than this is inside the measurement's noise. */
  noise: number
  /** Which way is good: 'phase' = by the phase's pace, null = never judged. */
  good: 'up' | 'down' | 'phase' | null
}

export const WEEKLY_METRICS: readonly WeeklyMetricMeta[] = [
  { key: 'weight', label: 'Weight', unit: 'kg', decimals: 1, noise: GOAL_NOISE.weight, good: 'phase' },
  { key: 'fat', label: 'Body fat', unit: '%', decimals: 1, noise: MIN_FAT_PCT_CHANGE, good: 'down' },
  { key: 'muscle', label: 'Muscle', unit: '%', decimals: 1, noise: 0.6, good: 'up' },
  { key: 'score', label: 'Body score', unit: '/100', decimals: 0, noise: 1, good: null },
]

/** good = the way the phase wants · bad = against it (or faster than its
 *  pace) · steady = inside the noise · plain = a real change nobody judges. */
export type ChangeVerdict = 'good' | 'bad' | 'steady' | 'plain'

export const VERDICT_TONE: Record<ChangeVerdict, 'success' | 'warn' | 'neutral'> = {
  good: 'success', bad: 'warn', steady: 'neutral', plain: 'neutral',
}

export interface WeekCell {
  /** The week's average (rounded to the column's decimals), null without a reading. */
  avg: number | null
  /** Days with a reading. */
  days: number
  /** avg − the week before's avg (both as shown), null when either is missing. */
  change: number | null
  verdict: ChangeVerdict | null
}

export interface WeekRow {
  weekStart: string
  weekEnd: string
  cells: Record<WeeklyMetric, WeekCell>
}

export type WeeklySeries = Record<WeeklyMetric, readonly DayValue[]>

const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp

/** The Mondays of the weeks that overlap the `spanDays` ending on `anchor`,
 *  newest first, at least `minWeeks` of them — a 7-day window still shows this
 *  week and the one before. */
export function weekStartsFor(anchor: string, spanDays: number, minWeeks = 2): string[] {
  const last = mondayOfIso(anchor)
  const first = mondayOfIso(addDaysIso(anchor, -(Math.max(1, spanDays) - 1)))
  const n = Math.max(minWeeks, daysBetweenIso(first, last) / 7 + 1)
  return Array.from({ length: n }, (_, i) => addDaysIso(last, -7 * i))
}

/** Mean of the readings in [from, to] (one value per day expected), or null. */
function weekMean(series: readonly DayValue[], from: string, to: string): { avg: number | null; days: number } {
  const vals = series.filter(d => d.date >= from && d.date <= to && Number.isFinite(d.value)).map(d => d.value)
  return { avg: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null, days: vals.length }
}

const WEIGHT_VERDICT: Record<RateStatus, ChangeVerdict> = {
  on_track: 'good', too_slow: 'good', stable: 'good',
  too_fast: 'bad', way_too_fast: 'bad', wrong_way: 'bad', drifting_down: 'bad', drifting_up: 'bad',
}

/** Whether a week-to-week change is good for the phase. `previous` is the
 *  week before's average (weight's pace is a share of it); a null phase (still
 *  loading) leaves weight unjudged. */
export function changeVerdict(meta: WeeklyMetricMeta, change: number, previous: number, phase: Phase | null): ChangeVerdict {
  if (Math.abs(change) < meta.noise - 1e-9) return 'steady'
  if (meta.good === 'up') return change > 0 ? 'good' : 'bad'
  if (meta.good === 'down') return change < 0 ? 'good' : 'bad'
  if (meta.good === 'phase' && phase && previous > 0) {
    // The way first, so a real change against the phase is never "too slow".
    if ((phase === 'cut' && change > 0) || (phase === 'gain' && change < 0)) return 'bad'
    return WEIGHT_VERDICT[classifyRate(phase, (change / previous) * 100)]
  }
  return 'plain'
}

/** The rows for the weeks starting on `weeks` (newest first). The week holding
 *  `anchor` counts only the days up to it. */
export function buildWeeklyChanges(series: WeeklySeries, weeks: readonly string[], anchor: string, phase: Phase | null): WeekRow[] {
  return weeks.map(weekStart => {
    const weekEnd = addDaysIso(weekStart, 6)
    const to = weekEnd < anchor ? weekEnd : anchor
    const prevStart = addDaysIso(weekStart, -7)
    const cells = {} as Record<WeeklyMetric, WeekCell>
    for (const meta of WEEKLY_METRICS) {
      const cur = weekMean(series[meta.key], weekStart, to)
      const prev = weekMean(series[meta.key], prevStart, addDaysIso(prevStart, 6))
      const avg = cur.avg == null ? null : round(cur.avg, meta.decimals)
      const before = prev.avg == null ? null : round(prev.avg, meta.decimals)
      const change = avg != null && before != null ? round(avg - before, meta.decimals) : null
      cells[meta.key] = {
        avg, days: cur.days, change,
        verdict: change != null && before != null ? changeVerdict(meta, change, before, phase) : null,
      }
    }
    return { weekStart, weekEnd, cells }
  })
}

/** The rows from the week of the first reading on — weeks before anything was
 *  measured aren't gaps, so a year view doesn't open with months of "–".
 *  `first` is the earliest reading in any column, `dropped` the rows cut. */
export function sinceFirstReading(rows: readonly WeekRow[], series: WeeklySeries): { rows: WeekRow[]; first: string | null; dropped: number } {
  let first: string | null = null
  for (const s of Object.values(series)) for (const d of s) if (first == null || d.date < first) first = d.date
  const kept = first == null ? [] : rows.filter(r => r.weekEnd >= (first as string))
  return { rows: kept, first, dropped: rows.length - kept.length }
}

/** The columns worth a place: weight always, the rest only when one of the
 *  rows has a reading (muscle and body score exist only in photo reports). */
export function shownMetrics(rows: readonly WeekRow[]): WeeklyMetricMeta[] {
  return WEEKLY_METRICS.filter(m => m.key === 'weight' || rows.some(r => r.cells[m.key].avg != null))
}
