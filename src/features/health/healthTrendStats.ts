// Trend statistics for the Health page: how a metric has moved over 7, 30 and
// 90 days, its weekly rate, its best and worst week, and whether it has become
// steadier or more erratic. Plus the small derived reads the hero needs (wake-
// time spread, a personal "usual range", the overnight-vitals status line).
//
// PURE — only the sibling pure healthWindowStats module is imported, so
// scripts/verify-health-trend-stats.cjs can load it through sucrase.
//
// Dates are local calendar days ('yyyy-MM-dd'). A day with no reading is
// simply absent from a series; nothing here ever treats a gap as zero.
import { addDaysIso, daysBetweenIso, linearTrendPerDay, mean, median, stdDev, type DayValue } from './healthWindowStats'

// ── Windows ──────────────────────────────────────────────────────────────────

function valuesIn(series: readonly DayValue[], from: string, to: string, exclude?: string | null): number[] {
  return series
    .filter(d => d.date >= from && d.date <= to && d.date !== exclude && Number.isFinite(d.value))
    .map(d => d.value)
}

/** Mean of the readings in the `days` ending on `date` (inclusive), or null. */
export function movingAverageAt(series: readonly DayValue[], date: string, days: number, opts: { minPoints?: number; exclude?: string | null } = {}): number | null {
  const vals = valuesIn(series, addDaysIso(date, -(days - 1)), date, opts.exclude)
  return vals.length >= (opts.minPoints ?? 1) ? mean(vals) : null
}

export interface PeriodChange {
  days: number
  /** Mean of the readings in the `days` ending on `to`. */
  current: number | null
  /** Mean of the readings in the `days` before that. */
  previous: number | null
  delta: number | null
  deltaPct: number | null
  nCurrent: number
  nPrevious: number
}

/**
 * The last `days` against the `days` before them — both as a mean of the
 * readings present, so a sum metric (steps) reads "per day" on both sides and
 * a sparse one (weight) compares like with like. `exclude` drops a day (today
 * while it is still in progress). Each side needs `minPoints` readings.
 */
export function periodChange(
  series: readonly DayValue[],
  opts: { to: string; days: number; exclude?: string | null; minPoints?: number },
): PeriodChange {
  const { to, days } = opts
  const minPoints = opts.minPoints ?? (days <= 7 ? 1 : 3)
  const cur = valuesIn(series, addDaysIso(to, -(days - 1)), to, opts.exclude)
  const prev = valuesIn(series, addDaysIso(to, -(2 * days - 1)), addDaysIso(to, -days), opts.exclude)
  const current = cur.length >= minPoints ? mean(cur) : null
  const previous = prev.length >= minPoints ? mean(prev) : null
  const delta = current != null && previous != null ? current - previous : null
  const deltaPct = delta != null && previous ? (delta / Math.abs(previous)) * 100 : null
  return { days, current, previous, delta, deltaPct, nCurrent: cur.length, nPrevious: prev.length }
}

/** Least-squares change per WEEK over the `days` ending on `to`. Needs
 *  `minPoints` readings spanning at least `minSpanDays`. */
export function weeklyRate(
  series: readonly DayValue[],
  opts: { to: string; days: number; exclude?: string | null; minPoints?: number; minSpanDays?: number },
): { perWeek: number; n: number } | null {
  const from = addDaysIso(opts.to, -(opts.days - 1))
  const pts = series
    .filter(d => d.date >= from && d.date <= opts.to && d.date !== opts.exclude && Number.isFinite(d.value))
    .sort((a, b) => a.date.localeCompare(b.date))
  if (pts.length < (opts.minPoints ?? 3)) return null
  if (daysBetweenIso(pts[0].date, pts[pts.length - 1].date) < (opts.minSpanDays ?? 7)) return null
  const t = linearTrendPerDay(pts)
  return t ? { perWeek: t.slopePerDay * 7, n: t.n } : null
}

// ── Weeks ────────────────────────────────────────────────────────────────────

/** The Monday on or before a date (ISO weeks, as Training uses). */
export function mondayOfIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDaysIso(date, -((dow + 6) % 7))
}

export interface WeekBucket {
  weekStart: string
  /** Mean per day with a reading ('mean'), or the week's total ('total'). */
  value: number
  days: number
}

/**
 * COMPLETE Monday–Sunday weeks inside [from, to] — a week still in progress
 * would always look like the worst one. A week needs `minDays` readings.
 */
export function weeklyBuckets(
  series: readonly DayValue[],
  opts: { from: string; to: string; agg: 'mean' | 'total'; minDays?: number },
): WeekBucket[] {
  const minDays = opts.minDays ?? 4
  const out: WeekBucket[] = []
  let wk = mondayOfIso(opts.from)
  if (wk < opts.from) wk = addDaysIso(wk, 7)
  for (; addDaysIso(wk, 6) <= opts.to; wk = addDaysIso(wk, 7)) {
    const vals = valuesIn(series, wk, addDaysIso(wk, 6))
    if (vals.length < minDays) continue
    const total = vals.reduce((a, b) => a + b, 0)
    out.push({ weekStart: wk, value: opts.agg === 'total' ? total : total / vals.length, days: vals.length })
  }
  return out
}

/** Best and worst week. `direction` says which way is better; null (a
 *  range is best) returns the highest as `best` and lowest as `worst`, which
 *  the caller labels "highest" / "lowest". */
export function bestWorstWeek(weeks: readonly WeekBucket[], direction: 'up' | 'down' | null): { best: WeekBucket | null; worst: WeekBucket | null } {
  if (weeks.length < 2) return { best: null, worst: null }
  let hi = weeks[0], lo = weeks[0]
  for (const w of weeks) {
    if (w.value > hi.value) hi = w
    if (w.value < lo.value) lo = w
  }
  return direction === 'down' ? { best: lo, worst: hi } : { best: hi, worst: lo }
}

// ── Variability ──────────────────────────────────────────────────────────────

export interface VariabilityChange {
  days: number
  sd: number | null
  previousSd: number | null
  /** sd / mean — comparable when the level itself moved. */
  cv: number | null
  previousCv: number | null
  /** 'steadier' / 'more variable' when the SD moved by 15% or more, else 'similar'. */
  verdict: 'steadier' | 'more variable' | 'similar' | null
}

/** Day-to-day spread of the last `days` against the `days` before. Each
 *  side needs `minPoints` readings. */
export function variabilityChange(
  series: readonly DayValue[],
  opts: { to: string; days: number; exclude?: string | null; minPoints?: number },
): VariabilityChange {
  const minPoints = opts.minPoints ?? 5
  const cur = valuesIn(series, addDaysIso(opts.to, -(opts.days - 1)), opts.to, opts.exclude)
  const prev = valuesIn(series, addDaysIso(opts.to, -(2 * opts.days - 1)), addDaysIso(opts.to, -opts.days), opts.exclude)
  const sd = cur.length >= minPoints ? stdDev(cur) : null
  const previousSd = prev.length >= minPoints ? stdDev(prev) : null
  const m = mean(cur), pm = mean(prev)
  const cv = sd != null && m ? sd / Math.abs(m) : null
  const previousCv = previousSd != null && pm ? previousSd / Math.abs(pm) : null
  let verdict: VariabilityChange['verdict'] = null
  if (sd != null && previousSd != null) {
    const ratio = previousSd === 0 ? (sd === 0 ? 1 : Infinity) : sd / previousSd
    verdict = ratio <= 0.85 ? 'steadier' : ratio >= 1.15 ? 'more variable' : 'similar'
  }
  return { days: opts.days, sd, previousSd, cv, previousCv, verdict }
}

// ── The bundle a section shows ───────────────────────────────────────────────

export interface TrendStats {
  changes: PeriodChange[]
  rate: { perWeek: number; n: number; days: number } | null
  best: WeekBucket | null
  worst: WeekBucket | null
  weeksCompared: number
  variability: VariabilityChange
}

export interface TrendStatsOptions {
  to: string
  /** Leave this day out (today, while it is still in progress). */
  exclude?: string | null
  /** 'mean' for rates and levels (and per-day sums); 'total' for a weekly total. */
  weekAgg?: 'mean' | 'total'
  direction: 'up' | 'down' | null
  /** Window of the weekly rate; 28 days by default. */
  rateDays?: number
  /** Sparse metrics (weight) need fewer readings per side. */
  sparse?: boolean
}

export function buildTrendStats(series: readonly DayValue[], opts: TrendStatsOptions): TrendStats {
  const { to, exclude, sparse } = opts
  const changes = [7, 30, 90].map(days => periodChange(series, {
    to, days, exclude, minPoints: sparse ? (days <= 7 ? 1 : 2) : (days <= 7 ? 3 : Math.ceil(days / 3)),
  }))
  const rateDays = opts.rateDays ?? 28
  const r = weeklyRate(series, { to, days: rateDays, exclude, minPoints: sparse ? 3 : 7 })
  const weeks = weeklyBuckets(series, { from: addDaysIso(to, -89), to: exclude === to ? addDaysIso(to, -1) : to, agg: opts.weekAgg ?? 'mean', minDays: sparse ? 1 : 4 })
  const { best, worst } = bestWorstWeek(weeks, opts.direction)
  return {
    changes,
    rate: r ? { ...r, days: rateDays } : null,
    best, worst,
    weeksCompared: weeks.length,
    variability: variabilityChange(series, { to, days: 30, exclude, minPoints: sparse ? 3 : 7 }),
  }
}

// ── Sleep timing ─────────────────────────────────────────────────────────────

/**
 * Spread of a clock time across nights (minutes after midnight, 0–1439),
 * safe across midnight: a 23:50 and a 00:10 bedtime are 20 minutes apart,
 * not 23 hours. The centre is the circular mean; `sd` is the sample standard
 * deviation of each night's signed distance from it. null below `minNights`.
 */
export function timeOfDaySpread(minutes: readonly number[], minNights = 5): { center: number; sd: number; n: number } | null {
  const vals = minutes.filter(m => Number.isFinite(m))
  if (vals.length < minNights) return null
  let s = 0, c = 0
  for (const m of vals) { const a = (m / 1440) * 2 * Math.PI; s += Math.sin(a); c += Math.cos(a) }
  let center = (Math.atan2(s, c) / (2 * Math.PI)) * 1440
  if (center < 0) center += 1440
  const dev = vals.map(m => ((((m - center) % 1440) + 2160) % 1440) - 720)
  const sd = stdDev(dev) as number
  return { center: Math.round(center) % 1440, sd, n: vals.length }
}

/** Sleep onset (earliest session start) and wake (latest session end) of one night. */
export function nightBounds(sessions: readonly { startMs: number; endMs: number }[]): { onsetMs: number; wakeMs: number } | null {
  if (!sessions.length) return null
  return { onsetMs: Math.min(...sessions.map(s => s.startMs)), wakeMs: Math.max(...sessions.map(s => s.endMs)) }
}

/** "07:05" from minutes after midnight. */
export function fmtClock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

// ── Personal usual range + the overnight-vitals status ───────────────────────

export interface UsualRange { low: number; high: number; center: number; n: number }

/**
 * A personal "usual range" from past readings:
 *   - 'sd':     mean ± k·SD (HRV: ±1 SD, Plews 2013), widened to at least
 *               ±minHalfWidth so a very steady metric doesn't flag noise;
 *   - 'median': median ± halfWidth (respiratory rate: ±1.5 br/min).
 * null below `minPoints` readings.
 */
export function usualRange(
  values: readonly number[],
  spec: { mode: 'sd'; k: number; minHalfWidth?: number } | { mode: 'median'; halfWidth: number },
  minPoints = 10,
): UsualRange | null {
  const vals = values.filter(v => Number.isFinite(v))
  if (vals.length < minPoints) return null
  if (spec.mode === 'median') {
    const c = median(vals) as number
    return { low: c - spec.halfWidth, high: c + spec.halfWidth, center: c, n: vals.length }
  }
  const c = mean(vals) as number
  const half = Math.max(spec.k * (stdDev(vals) ?? 0), spec.minHalfWidth ?? 0)
  return { low: c - half, high: c + half, center: c, n: vals.length }
}

export type VitalState = 'inside' | 'above' | 'below' | 'unknown'

export function vitalState(value: number | null | undefined, range: UsualRange | null): VitalState {
  if (value == null || !Number.isFinite(value) || !range) return 'unknown'
  return value > range.high ? 'above' : value < range.low ? 'below' : 'inside'
}

export interface VitalsSummary {
  checked: number
  /** Readings off in their concerning direction. */
  outside: string[]
  /** Readings off in their good direction (HRV above your usual) — not counted as outside. */
  better: string[]
  tone: 'success' | 'neutral' | 'warn' | null
  text: string
}

/**
 * Apple-Vitals-style status: a COUNT of readings outside your own range,
 * never a weighted score. One outlier is common (a late meal, alcohol, a hard
 * session); two or more at once is the pattern worth a look. A reading off in
 * its `good` direction (HRV above your usual = well recovered, as the Heart &
 * vitals reading says) is never counted as a warning sign.
 */
export function summarizeVitals(items: readonly { label: string; state: VitalState; good?: 'above' | 'below' | null }[]): VitalsSummary {
  const known = items.filter(i => i.state !== 'unknown')
  const off = known.filter(i => i.state !== 'inside')
  const better = off.filter(i => i.good != null && i.state === i.good).map(i => i.label)
  const outside = off.filter(i => !(i.good != null && i.state === i.good)).map(i => i.label)
  if (!known.length) return { checked: 0, outside: [], better: [], tone: null, text: 'Not enough overnight readings yet' }
  if (!outside.length) {
    return { checked: known.length, outside, better, tone: 'success', text: `All ${known.length} in your usual range${better.length ? ' or better' : ''}` }
  }
  return {
    checked: known.length,
    outside,
    better,
    tone: outside.length >= 2 ? 'warn' : 'neutral',
    text: `${outside.length} of ${known.length} outside your usual range`,
  }
}
