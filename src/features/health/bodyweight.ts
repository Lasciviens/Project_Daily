// ONE bodyweight series from the places a weight can come from. Pure and
// import-free (scripts/verify-bodyweight.cjs).
//
// Before this, five readers each picked their own table, so the same person
// got a different "current weight" on each screen.
//
// Same-day precedence, highest first:
//   1. scale  — the smart scale, read from Apple Health (health_metrics
//               weight_body_mass / body_fat_percentage / lean_body_mass).
//               The scale's own app writes every weigh-in there; checked
//               against live data (Sep 2026): every photo-imported report
//               had the same reading in Apple Health, and the Hevy weights
//               were the scale's numbers typed in by hand. Rows an app wrote
//               for a hand-typed weight (Hevy writes its entries into Apple
//               Health too) are NOT the scale: they go to `hevy`.
//   2. report — the scale's report imported from a photo
//               (body_composition_reports). The same device, so it fills a
//               day Apple Health hasn't synced yet.
//   3. hevy   — a weight typed into Hevy (its own table, plus the copies Hevy
//               writes into Apple Health). Only for a day with no scale
//               reading at all.
// Days never merge across sources for the WEIGHT; body fat % and lean mass
// come from the weight's source when it has one, else from the next source
// that reported one that day (fatSource / leanSource say which; fatDevice /
// leanDevice which scale, since two scales' estimates don't line up).

export type BodyweightSource = 'scale' | 'report' | 'hevy'

export interface BodyweightPoint {
  date: string
  kg: number
  fatPct: number | null
  leanKg: number | null
  source: BodyweightSource
  fatSource: BodyweightSource | null
  leanSource: BodyweightSource | null
  /** The device (Apple Health source) behind fatPct / leanKg, when known. */
  fatDevice: string | null
  leanDevice: string | null
}

/** One reading as the api layer hands it over: a local calendar day plus an
 *  instant for ordering several readings on the same day. */
export interface BodyweightReading {
  date: string
  at: string
  kg: number | null
  fatPct: number | null
  leanKg?: number | null
  /** Which scale wrote it (its Apple Health source name); null when unknown.
   *  Two scales estimate body fat differently, so their fat % and lean mass
   *  never share a line (see currentDeviceSeries). */
  device?: string | null
}

export interface BodyweightInputs {
  scale: BodyweightReading[]
  report: BodyweightReading[]
  hevy: BodyweightReading[]
}

export const BODYWEIGHT_PRECEDENCE: readonly BodyweightSource[] = ['scale', 'report', 'hevy']

/** The scale itself (via Apple Health or its photo report) — not a hand-typed weight. */
export function isScaleSource(s: BodyweightSource | null | undefined): boolean {
  return s === 'scale' || s === 'report'
}

// Health Auto Export can emit pounds by locale and a scale can misread; a
// value outside these bounds isn't a human weight in kg / a body-fat reading.
const KG_MIN = 25, KG_MAX = 300
const FAT_MIN = 2, FAT_MAX = 75
const LEAN_MIN = 15, LEAN_MAX = 200

function inRange(v: number | null | undefined, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null
}

type DayValues = {
  kg: number | null; fatPct: number | null; leanKg: number | null
  fatDevice: string | null; leanDevice: string | null
}

/** The newest reading of a day per source (a day's LAST weigh-in, like
 *  Apple's 'latest' rule). Each field is picked separately, so a later
 *  weight-only reading doesn't erase an earlier fat %. */
function perDay(readings: BodyweightReading[]): Map<string, DayValues> {
  const sorted = [...readings].sort((a, b) => a.at.localeCompare(b.at))
  const out = new Map<string, DayValues>()
  for (const r of sorted) {
    const cur = out.get(r.date) ?? { kg: null, fatPct: null, leanKg: null, fatDevice: null, leanDevice: null }
    const kg = inRange(r.kg, KG_MIN, KG_MAX)
    const fat = inRange(r.fatPct, FAT_MIN, FAT_MAX)
    const lean = inRange(r.leanKg, LEAN_MIN, LEAN_MAX)
    if (kg != null) cur.kg = kg
    if (fat != null) { cur.fatPct = fat; cur.fatDevice = r.device ?? null }
    if (lean != null) { cur.leanKg = lean; cur.leanDevice = r.device ?? null }
    out.set(r.date, cur)
  }
  return out
}

export function mergeBodyweight(inputs: BodyweightInputs, range?: { from: string; to: string }): BodyweightPoint[] {
  const bySource: Record<BodyweightSource, Map<string, DayValues>> = {
    scale: perDay(inputs.scale), report: perDay(inputs.report), hevy: perDay(inputs.hevy),
  }
  const dates = new Set<string>()
  for (const src of BODYWEIGHT_PRECEDENCE) for (const d of bySource[src].keys()) dates.add(d)

  const out: BodyweightPoint[] = []
  for (const date of dates) {
    if (range && (date < range.from || date > range.to)) continue
    const source = BODYWEIGHT_PRECEDENCE.find(s => bySource[s].get(date)?.kg != null)
    if (!source) continue
    const day = (s: BodyweightSource) => bySource[s].get(date)
    const kg = day(source)!.kg as number
    const order = [source, ...BODYWEIGHT_PRECEDENCE.filter(s => s !== source)]
    const fatSource = order.find(s => day(s)?.fatPct != null) ?? null
    const leanSource = order.find(s => day(s)?.leanKg != null) ?? null
    out.push({
      date, kg, source,
      fatPct: fatSource ? day(fatSource)!.fatPct : null, fatSource,
      leanKg: leanSource ? day(leanSource)!.leanKg : null, leanSource,
      fatDevice: fatSource ? day(fatSource)!.fatDevice : null,
      leanDevice: leanSource ? day(leanSource)!.leanDevice : null,
    })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** The newest merged point; same-day ties already resolved by precedence. */
export function latestBodyweight(points: readonly BodyweightPoint[]): BodyweightPoint | null {
  return points.length ? points[points.length - 1] : null
}

// ─── Apple Health rows ────────────────────────────────────────────────────────

/** The body metrics the scale writes into Apple Health. */
export const APPLE_BODY_METRICS = ['weight_body_mass', 'body_fat_percentage', 'lean_body_mass'] as const

/** One health_metrics row, reduced to what the split needs. */
export interface AppleBodyRow {
  metric: string
  date: string
  at: string
  source: string | null | undefined
  qty: number | null | undefined
}

// Apps that write a hand-typed weight into Apple Health. Health Auto Export
// joins every contributing app into one '|'-separated source string; a row is
// manual only when every part is one of these (a mixed hour still holds the
// scale's reading).
const MANUAL_APPLE_SOURCES = [/\bhevy\b/i]

const sourceParts = (source: string | null | undefined) => (source ?? '').split('|').map(s => s.trim()).filter(Boolean)
const isManualPart = (part: string) => MANUAL_APPLE_SOURCES.some(re => re.test(part))

export function isManualAppleSource(source: string | null | undefined): boolean {
  const parts = sourceParts(source)
  return parts.length > 0 && parts.every(isManualPart)
}

/** The scale behind an Apple Health source string: its non-manual parts, so
 *  "Hevy|Scale App" and "Scale App" are the same device. Null when empty. */
export function appleDevice(source: string | null | undefined): string | null {
  const parts = sourceParts(source)
  const own = parts.filter(p => !isManualPart(p))
  return (own.length ? own : parts).sort().join('|') || null
}

/** Apple Health body rows → readings, split into the scale's and hand-typed
 *  ones. Body fat arrives either as a fraction (0.18) or a percentage (18). */
export function splitAppleBodyRows(rows: readonly AppleBodyRow[]): { scale: BodyweightReading[]; hevy: BodyweightReading[] } {
  const scale: BodyweightReading[] = [], hevy: BodyweightReading[] = []
  for (const r of rows) {
    if (typeof r.qty !== 'number' || !Number.isFinite(r.qty)) continue
    const reading: BodyweightReading = { date: r.date, at: r.at, kg: null, fatPct: null, leanKg: null, device: appleDevice(r.source) }
    if (r.metric === 'weight_body_mass') reading.kg = r.qty
    else if (r.metric === 'body_fat_percentage') reading.fatPct = r.qty <= 1 ? r.qty * 100 : r.qty
    else if (r.metric === 'lean_body_mass') reading.leanKg = r.qty
    else continue
    ;(isManualAppleSource(r.source) ? hevy : scale).push(reading)
  }
  return { scale, hevy }
}

// ─── The scale alone ──────────────────────────────────────────────────────────

export interface ScaleDay {
  date: string
  kg: number | null
  fatPct: number | null
  leanKg: number | null
  fatDevice: string | null
  leanDevice: string | null
}

/** Only what the scale measured: each value kept when its source is the
 *  scale (Apple Health or its report), a day dropped when nothing is. The
 *  Health → Body window draws this; a hand-typed weight never appears there. */
export function scaleOnly(points: readonly BodyweightPoint[]): ScaleDay[] {
  const out: ScaleDay[] = []
  for (const p of points) {
    const day: ScaleDay = {
      date: p.date,
      kg: isScaleSource(p.source) ? p.kg : null,
      fatPct: isScaleSource(p.fatSource) ? p.fatPct : null,
      leanKg: isScaleSource(p.leanSource) ? p.leanKg : null,
      fatDevice: isScaleSource(p.fatSource) ? p.fatDevice : null,
      leanDevice: isScaleSource(p.leanSource) ? p.leanDevice : null,
    }
    if (day.kg != null || day.fatPct != null || day.leanKg != null) out.push(day)
  }
  return out
}

/** Body fat % or lean mass from the scale in use only. Weight agrees across
 *  scales, but their body-fat estimates don't (live data: two percentage
 *  points apart on the same morning at the same weight when the scale was
 *  replaced), so a line through both would show a drop that never happened. The scale in use
 *  is the one behind the newest reading; a reading with no known device (a
 *  photo report) counts as that scale's. `since` is its first reading and
 *  `dropped` how many earlier readings came from another scale. */
export function currentDeviceSeries(days: readonly ScaleDay[], field: 'fatPct' | 'leanKg'): {
  readings: { date: string; value: number }[]
  device: string | null
  since: string | null
  dropped: number
} {
  const deviceOf = (d: ScaleDay) => (field === 'fatPct' ? d.fatDevice : d.leanDevice)
  const all = days.filter(d => d[field] != null)
  const device = [...all].reverse().map(deviceOf).find(v => v != null) ?? null
  const kept = all.filter(d => deviceOf(d) == null || deviceOf(d) === device)
  return {
    readings: kept.map(d => ({ date: d.date, value: d[field] as number })),
    device,
    since: all.find(d => device != null && deviceOf(d) === device)?.date ?? null,
    dropped: all.length - kept.length,
  }
}

/** A y-axis range for a scale chart: the readings' range, widened to at least
 *  `minSpan` around its middle and rounded out to a round unit (1 for a
 *  few-kg range, 10 for a kcal range…) in steps the axis can split evenly,
 *  so ordinary morning-to-morning noise
 *  (±0.5 kg or % on a bioimpedance scale) doesn't fill the chart and read as a
 *  cliff, and the axis ticks land on round numbers. Undefined without readings. */
export function scaleChartDomain(values: readonly number[], minSpan: number): [number, number] | undefined {
  const vs = values.filter(v => Number.isFinite(v))
  if (!vs.length) return undefined
  const min = Math.min(...vs)
  let lo = min, hi = Math.max(...vs)
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  const exp = Math.floor(Math.log10(Math.max(hi - lo, 1e-6) / 2))
  const unit = 10 ** exp
  const dec = Math.max(0, -exp)
  // A whole number of units that splits into the axis's 4 intervals evenly,
  // so the 5 ticks are round (80, 81…) rather than 80.75.
  let a = Math.floor(lo / unit), b = Math.ceil(hi / unit)
  const extra = Math.ceil((b - a) / 4) * 4 - (b - a)
  a -= Math.floor(extra / 2)
  b += Math.ceil(extra / 2)
  if (a < 0 && min >= 0) { b -= a; a = 0 }
  return [+(a * unit).toFixed(dec), +(b * unit).toFixed(dec)]
}

export const BODYWEIGHT_SOURCE_LABEL: Record<BodyweightSource, string> = {
  scale: 'Smart scale',
  report: 'Scale report',
  hevy: 'Hevy (manual)',
}
