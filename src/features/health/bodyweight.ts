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
// that reported one that day (fatSource / leanSource say which).

export type BodyweightSource = 'scale' | 'report' | 'hevy'

export interface BodyweightPoint {
  date: string
  kg: number
  fatPct: number | null
  leanKg: number | null
  source: BodyweightSource
  fatSource: BodyweightSource | null
  leanSource: BodyweightSource | null
}

/** One reading as the api layer hands it over: a local calendar day plus an
 *  instant for ordering several readings on the same day. */
export interface BodyweightReading {
  date: string
  at: string
  kg: number | null
  fatPct: number | null
  leanKg?: number | null
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

type DayValues = { kg: number | null; fatPct: number | null; leanKg: number | null }

/** The newest reading of a day per source (a day's LAST weigh-in, like
 *  Apple's 'latest' rule). Each field is picked separately, so a later
 *  weight-only reading doesn't erase an earlier fat %. */
function perDay(readings: BodyweightReading[]): Map<string, DayValues> {
  const sorted = [...readings].sort((a, b) => a.at.localeCompare(b.at))
  const out = new Map<string, DayValues>()
  for (const r of sorted) {
    const cur = out.get(r.date) ?? { kg: null, fatPct: null, leanKg: null }
    const kg = inRange(r.kg, KG_MIN, KG_MAX)
    const fat = inRange(r.fatPct, FAT_MIN, FAT_MAX)
    const lean = inRange(r.leanKg, LEAN_MIN, LEAN_MAX)
    if (kg != null) cur.kg = kg
    if (fat != null) cur.fatPct = fat
    if (lean != null) cur.leanKg = lean
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

export function isManualAppleSource(source: string | null | undefined): boolean {
  const parts = (source ?? '').split('|').map(s => s.trim()).filter(Boolean)
  return parts.length > 0 && parts.every(p => MANUAL_APPLE_SOURCES.some(re => re.test(p)))
}

/** Apple Health body rows → readings, split into the scale's and hand-typed
 *  ones. Body fat arrives either as a fraction (0.18) or a percentage (18). */
export function splitAppleBodyRows(rows: readonly AppleBodyRow[]): { scale: BodyweightReading[]; hevy: BodyweightReading[] } {
  const scale: BodyweightReading[] = [], hevy: BodyweightReading[] = []
  for (const r of rows) {
    if (typeof r.qty !== 'number' || !Number.isFinite(r.qty)) continue
    const reading: BodyweightReading = { date: r.date, at: r.at, kg: null, fatPct: null, leanKg: null }
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
    }
    if (day.kg != null || day.fatPct != null || day.leanKg != null) out.push(day)
  }
  return out
}

export const BODYWEIGHT_SOURCE_LABEL: Record<BodyweightSource, string> = {
  scale: 'Smart scale',
  report: 'Scale report',
  hevy: 'Hevy (manual)',
}
