// ONE bodyweight series from the three places a weight can come from. Pure and
// import-free (scripts/verify-bodyweight.cjs).
//
// Before this, five readers each picked their own table: Progress merged Hevy
// with Apple Health, the nutrition coach, the PT coach, the coach chat and
// Daily read Apple Health only, the Hevy Body tab read Hevy only, and nothing
// read the smart scale actually in use (body_composition_reports). The same
// person got a different "current weight" on each screen.
//
// Same-day precedence, highest first:
//   1. hevy  — a weight typed into Hevy by hand. A deliberate entry outranks
//              any device, the same "manual beats device" rule manual sleep
//              already follows.
//   2. scale — the smart-scale report. The dedicated device in use, measured
//              with its own full report.
//   3. apple — Apple Health's weight_body_mass. A downstream copy: often the
//              scale's own write or another app's, so it only fills days the
//              first two have nothing for.
// Days never merge across sources for the WEIGHT; body fat % comes from the
// same source as the weight when it has one, else from the next source that
// reported one that day (fatSource says which).

export type BodyweightSource = 'hevy' | 'scale' | 'apple'

export interface BodyweightPoint {
  date: string
  kg: number
  fatPct: number | null
  source: BodyweightSource
  fatSource: BodyweightSource | null
}

/** One reading as the api layer hands it over: a local calendar day plus an
 *  instant for ordering several readings on the same day. */
export interface BodyweightReading {
  date: string
  at: string
  kg: number | null
  fatPct: number | null
}

export interface BodyweightInputs {
  hevy: BodyweightReading[]
  scale: BodyweightReading[]
  apple: BodyweightReading[]
}

export const BODYWEIGHT_PRECEDENCE: readonly BodyweightSource[] = ['hevy', 'scale', 'apple']

// Health Auto Export can emit pounds by locale and a scale can misread; a
// value outside these bounds isn't a human weight in kg / a body-fat reading.
const KG_MIN = 25, KG_MAX = 300
const FAT_MIN = 2, FAT_MAX = 75

function validKg(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= KG_MIN && v <= KG_MAX ? v : null
}
function validFat(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= FAT_MIN && v <= FAT_MAX ? v : null
}

/** The newest reading of a day per source (a day's LAST weigh-in, like
 *  Apple's 'latest' rule). Weight and fat are picked separately, so a later
 *  weight-only reading doesn't erase an earlier fat %. */
function perDay(readings: BodyweightReading[]): Map<string, { kg: number | null; fatPct: number | null }> {
  const sorted = [...readings].sort((a, b) => a.at.localeCompare(b.at))
  const out = new Map<string, { kg: number | null; fatPct: number | null }>()
  for (const r of sorted) {
    const cur = out.get(r.date) ?? { kg: null, fatPct: null }
    const kg = validKg(r.kg), fat = validFat(r.fatPct)
    if (kg != null) cur.kg = kg
    if (fat != null) cur.fatPct = fat
    out.set(r.date, cur)
  }
  return out
}

export function mergeBodyweight(inputs: BodyweightInputs, range?: { from: string; to: string }): BodyweightPoint[] {
  const bySource: Record<BodyweightSource, Map<string, { kg: number | null; fatPct: number | null }>> = {
    hevy: perDay(inputs.hevy), scale: perDay(inputs.scale), apple: perDay(inputs.apple),
  }
  const dates = new Set<string>()
  for (const src of BODYWEIGHT_PRECEDENCE) for (const d of bySource[src].keys()) dates.add(d)

  const out: BodyweightPoint[] = []
  for (const date of dates) {
    if (range && (date < range.from || date > range.to)) continue
    const source = BODYWEIGHT_PRECEDENCE.find(s => bySource[s].get(date)?.kg != null)
    if (!source) continue
    const kg = bySource[source].get(date)!.kg as number
    const order = [source, ...BODYWEIGHT_PRECEDENCE.filter(s => s !== source)]
    const fatSource = order.find(s => bySource[s].get(date)?.fatPct != null) ?? null
    const fatPct = fatSource ? (bySource[fatSource].get(date)!.fatPct as number) : null
    out.push({ date, kg, fatPct, source, fatSource })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** The newest merged point; same-day ties already resolved by precedence. */
export function latestBodyweight(points: readonly BodyweightPoint[]): BodyweightPoint | null {
  return points.length ? points[points.length - 1] : null
}

export const BODYWEIGHT_SOURCE_LABEL: Record<BodyweightSource, string> = {
  hevy: 'Hevy (manual)',
  scale: 'Smart scale',
  apple: 'Apple Health',
}
