// Pure window statistics for every Health headline number. Import-free on
// purpose (scripts/verify-health-window-stats.cjs requires it through sucrase).
//
// Why this exists: the same labelled figure ("weekly average steps") used to be
// computed three different ways — the section headline counted today's
// unfinished day, the side panel dropped today everywhere (so Day mode on today
// was all dashes and last night never counted), and Daily's card had its own
// rule. Every surface now calls summarizeWindow, so a label can only ever show
// one number.
//
// Dates are local calendar days as 'yyyy-MM-dd' strings. The arithmetic below
// runs on UTC midnights purely as a day counter, so no timezone or DST shift
// can move a date.

export interface DayValue { date: string; value: number }
export interface DayPoint { date: string; value: number | null }

// ── Date helpers ─────────────────────────────────────────────────────────────

function toDayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000)
}

function fromDayNumber(n: number): string {
  const d = new Date(n * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export function addDaysIso(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days)
}

/** Whole days from a to b (b − a). */
export function daysBetweenIso(a: string, b: string): number {
  return toDayNumber(b) - toDayNumber(a)
}

/** Every date from `from` to `to`, inclusive. Empty when to < from. */
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let n = toDayNumber(from), end = toDayNumber(to); n <= end; n++) out.push(fromDayNumber(n))
  return out
}

/** A dense series over [from, to]: a day with no reading is null, never 0 —
 *  a Watch-off day is a gap in the chart, not a zero bar. */
export function fillDays(series: readonly DayValue[], from: string, to: string): DayPoint[] {
  const byDate = new Map<string, number>()
  for (const d of series) if (Number.isFinite(d.value)) byDate.set(d.date, d.value)
  return datesInRange(from, to).map(date => ({ date, value: byDate.get(date) ?? null }))
}

// ── Windows ──────────────────────────────────────────────────────────────────

/** The selected window plus the same-length window before it (for the trend). */
export interface HealthWindow {
  from: string
  to: string
  prevFrom: string
  prevTo: string
  /** First day to fetch so one download covers both windows. */
  fetchFrom: string
  today: string
  isDay: boolean
  totalDays: number
}

export function makeWindow(from: string, to: string, today: string): HealthWindow {
  const totalDays = daysBetweenIso(from, to) + 1
  const prevTo = addDaysIso(from, -1)
  const prevFrom = addDaysIso(from, -totalDays)
  return { from, to, prevFrom, prevTo, fetchFrom: prevFrom, today, isDay: totalDays === 1, totalDays }
}

// ── Basic statistics ─────────────────────────────────────────────────────────

export function mean(values: readonly number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

export function median(values: readonly number[]): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Sample standard deviation (n − 1). null below two values. */
export function stdDev(values: readonly number[]): number | null {
  if (values.length < 2) return null
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1))
}

// ── The in-progress-day rule ─────────────────────────────────────────────────

export type WindowKind = 'sum' | 'average' | 'latest'

/** How a metric's days combine into one window number, and whether TODAY is
 *  already complete.
 *  - sum (steps, energy, minutes): a day's total grows until midnight, so today
 *    is in progress and stays out of multi-day means.
 *  - average / minmaxavg (rates, heart rate): today's partial mean is biased by
 *    the time of day, so it stays out of multi-day means too.
 *  - sleep: nights are filed under the day you WOKE UP, so today's key is last
 *    night, a finished night. It always counts.
 *  - latest (weight, VO2 max, resting HR): a point reading; the newest one is
 *    the answer and today's reading is as complete as any other. */
export function windowRuleFor(aggType: string): { kind: WindowKind; todayComplete: boolean } {
  if (aggType === 'sum') return { kind: 'sum', todayComplete: false }
  if (aggType === 'sleep') return { kind: 'average', todayComplete: true }
  if (aggType === 'latest') return { kind: 'latest', todayComplete: true }
  return { kind: 'average', todayComplete: false }
}

export interface SummarizeOptions {
  from: string
  to: string
  today: string
  /** Defaults to false for sum/average (see windowRuleFor). */
  todayComplete?: boolean
  /** Completeness floor: a day failing this is kept in the chart but left out
   *  of the mean (e.g. an energy day under the basal floor = Watch off). */
  isDayComplete?: (d: DayValue) => boolean
}

export interface WindowSummary {
  /** The headline: that day's value (Day), the mean per day (sum/average), or
   *  the newest reading (latest). */
  value: number | null
  /** Same rule over the same-length window just before. */
  previous: number | null
  delta: number | null
  deltaPct: number | null
  /** Days in the window with any reading, today included. */
  daysWithData: number
  /** Days that fed `value`. */
  daysCounted: number
  totalDays: number
  /** The window holds today and today is still in progress: a Day value reads
   *  "so far", and multi-day means leave today out. */
  partialToday: boolean
  /** Sum kind only: every day's total added up, today's partial included. */
  total: number | null
  /** The day `value` comes from (latest kind, or a Day window). */
  latestDate: string | null
  best: DayValue | null
  worst: DayValue | null
}

function inRange(series: readonly DayValue[], from: string, to: string): DayValue[] {
  return series
    .filter(d => d.date >= from && d.date <= to && Number.isFinite(d.value))
    .sort((a, b) => a.date.localeCompare(b.date))
}

function extremes(days: DayValue[]): { best: DayValue | null; worst: DayValue | null } {
  if (!days.length) return { best: null, worst: null }
  let best = days[0], worst = days[0]
  for (const d of days) {
    if (d.value > best.value) best = d
    if (d.value < worst.value) worst = d
  }
  return { best, worst }
}

export function summarizeWindow(kind: WindowKind, series: readonly DayValue[], opts: SummarizeOptions): WindowSummary {
  const { from, to, today } = opts
  const todayComplete = opts.todayComplete ?? kind === 'latest'
  const complete = opts.isDayComplete ?? (() => true)
  const totalDays = daysBetweenIso(from, to) + 1
  const prevTo = addDaysIso(from, -1)
  const prevFrom = addDaysIso(from, -totalDays)

  const days = inRange(series, from, to)
  const prevDays = inRange(series, prevFrom, prevTo)
  const containsToday = from <= today && today <= to
  const partialToday = containsToday && !todayComplete

  let value: number | null
  let previous: number | null
  let counted: DayValue[]
  let latestDate: string | null = null

  if (kind === 'latest') {
    const last = days[days.length - 1]
    value = last?.value ?? null
    latestDate = last?.date ?? null
    previous = prevDays[prevDays.length - 1]?.value ?? null
    counted = last ? [last] : []
  } else if (totalDays === 1) {
    // One day: show it even while in progress, labelled "so far" by the caller.
    const d = days[0]
    value = d?.value ?? null
    latestDate = d?.date ?? null
    previous = prevDays[0]?.value ?? null
    counted = d ? [d] : []
  } else {
    counted = days.filter(d => !(partialToday && d.date === today) && complete(d))
    value = mean(counted.map(d => d.value))
    previous = mean(prevDays.filter(complete).map(d => d.value))
  }

  // A partial day against a finished one is not a trend.
  const comparable = value != null && previous != null && !(totalDays === 1 && partialToday && kind !== 'latest')
  const delta = comparable ? (value as number) - (previous as number) : null
  const deltaPct = delta != null && previous !== 0 ? (delta / Math.abs(previous as number)) * 100 : null

  const total = kind === 'sum' && days.length ? days.reduce((s, d) => s + d.value, 0) : null
  const { best, worst } = extremes(totalDays === 1 ? days : counted)

  return {
    value, previous, delta, deltaPct,
    daysWithData: days.length,
    daysCounted: counted.length,
    totalDays,
    partialToday: partialToday && kind !== 'latest',
    total, latestDate, best, worst,
  }
}

// ── Trend helpers ────────────────────────────────────────────────────────────

/** Trailing mean over the previous `windowDays` entries of a DENSE series
 *  (fillDays output). A point needs `minCount` readings in its window, else it
 *  stays null — a two-reading "7-day average" isn't one. */
export function rollingMean(points: readonly DayPoint[], windowDays: number, minCount = 1): DayPoint[] {
  return points.map((p, i) => {
    const slice = points.slice(Math.max(0, i - windowDays + 1), i + 1)
      .map(x => x.value).filter((v): v is number => v != null)
    return { date: p.date, value: slice.length >= minCount ? (mean(slice) as number) : null }
  })
}

export interface Baseline { mean: number; sd: number | null; median: number; n: number }

/** A personal reference level from the readings in [from, to]. null below
 *  `minPoints` readings — a baseline from a handful of days is noise. */
export function personalBaseline(series: readonly DayValue[], opts: { from: string; to: string; minPoints?: number }): Baseline | null {
  const vals = inRange(series, opts.from, opts.to).map(d => d.value)
  if (vals.length < (opts.minPoints ?? 14)) return null
  return { mean: mean(vals) as number, sd: stdDev(vals), median: median(vals) as number, n: vals.length }
}

/** Least-squares slope per day over (days since the first reading, value).
 *  null without two readings on different days. */
export function linearTrendPerDay(series: readonly DayValue[]): { slopePerDay: number; n: number } | null {
  const pts = [...series].filter(d => Number.isFinite(d.value)).sort((a, b) => a.date.localeCompare(b.date))
  if (pts.length < 2) return null
  const x0 = pts[0].date
  const xs = pts.map(p => daysBetweenIso(x0, p.date))
  if (xs[xs.length - 1] === 0) return null
  const mx = mean(xs) as number, my = mean(pts.map(p => p.value)) as number
  let num = 0, den = 0
  pts.forEach((p, i) => { num += (xs[i] - mx) * (p.value - my); den += (xs[i] - mx) ** 2 })
  return den ? { slopePerDay: num / den, n: pts.length } : null
}

/** The newest reading on or before `date`, against the median of the readings
 *  in the `lookbackDays` before it — how Apple shows wrist temperature (a
 *  deviation from your own usual night, not the absolute skin temperature). */
export function baselineDeviation(
  series: readonly DayValue[], date: string, opts: { lookbackDays?: number; minPoints?: number } = {},
): { value: number; date: string; baseline: number; deviation: number; n: number } | null {
  const lookback = opts.lookbackDays ?? 60
  const upTo = inRange(series, '0000-01-01', date)
  const last = upTo[upTo.length - 1]
  if (!last) return null
  const prior = inRange(series, addDaysIso(last.date, -lookback), addDaysIso(last.date, -1)).map(d => d.value)
  if (prior.length < (opts.minPoints ?? 5)) return null
  const base = median(prior) as number
  return { value: last.value, date: last.date, baseline: base, deviation: last.value - base, n: prior.length }
}
