// Numeric reference tables behind healthBenchmarks.ts. Pure data, import-free.
// Every row is copied from the primary table named next to it; values the
// fact-check could not confirm are not here (see the notes per table).

/** A percentile ladder: [percentile, value] pairs, both ascending. */
export type PercentileTable = ReadonlyArray<readonly [number, number]>

export interface AgeRow<T> {
  /** Inclusive age bounds of the source's band. */
  min: number
  max: number
  data: T
}

// ─── VO2 max — FRIEND 2015, treadmill, directly measured (Table 3) ──────────
// The fully verified table. FRIEND 2022 (more US-representative, medians
// 1.5–4.6 ml/kg/min lower) could not be opened at the source and two secondary
// transcriptions disagree by up to 1.1, so it is deliberately not used — and
// the two versions are never mixed.
const P = [5, 10, 25, 50, 75, 90, 95] as const
function ladder(values: readonly number[]): PercentileTable {
  return P.map((p, i) => [p, values[i]] as const)
}

export const VO2_FRIEND_2015: Record<'male' | 'female', AgeRow<PercentileTable>[]> = {
  male: [
    { min: 20, max: 29, data: ladder([29.0, 32.1, 40.1, 48.0, 55.2, 61.8, 66.3]) },
    { min: 30, max: 39, data: ladder([27.2, 30.2, 35.9, 42.4, 49.2, 56.5, 59.8]) },
    { min: 40, max: 49, data: ladder([24.2, 26.8, 31.9, 37.8, 45.0, 52.1, 55.6]) },
    { min: 50, max: 59, data: ladder([20.9, 22.8, 27.1, 32.6, 39.7, 45.6, 50.7]) },
    { min: 60, max: 69, data: ladder([17.4, 19.8, 23.7, 28.2, 34.5, 40.3, 43.0]) },
    { min: 70, max: 79, data: ladder([16.3, 17.1, 20.4, 24.4, 30.4, 36.6, 39.7]) },
  ],
  female: [
    { min: 20, max: 29, data: ladder([21.7, 23.9, 30.5, 37.6, 44.7, 51.3, 56.0]) },
    { min: 30, max: 39, data: ladder([19.0, 20.9, 25.3, 30.2, 36.1, 41.4, 45.8]) },
    { min: 40, max: 49, data: ladder([17.0, 18.8, 22.1, 26.7, 32.4, 38.4, 41.7]) },
    { min: 50, max: 59, data: ladder([16.0, 17.3, 19.9, 23.4, 27.6, 32.0, 35.9]) },
    { min: 60, max: 69, data: ladder([13.4, 14.6, 17.2, 20.0, 23.8, 27.0, 29.4]) },
    { min: 70, max: 79, data: ladder([13.1, 13.6, 15.6, 18.3, 20.8, 23.1, 24.1]) },
  ],
}

/** Healthy Norwegian volunteers, treadmill with gas analysis (HUNT3, Loe 2013
 *  Table 2). Men only; 60+ are NTNU CERG's rounded means with no SD. */
export const VO2_HUNT3_MEN: AgeRow<{ mean: number; sd: number | null }>[] = [
  { min: 20, max: 29, data: { mean: 54.4, sd: 8.4 } },
  { min: 30, max: 39, data: { mean: 49.1, sd: 7.5 } },
  { min: 40, max: 49, data: { mean: 47.2, sd: 7.7 } },
  { min: 50, max: 59, data: { mean: 42.6, sd: 7.4 } },
  { min: 60, max: 69, data: { mean: 39, sd: null } },
  { min: 70, max: 79, data: { mean: 34, sd: null } },
]

/** Kodama 2009 absolute categories, sex- and age-independent (METs). */
export const VO2_KODAMA_METS = { lowBelow: 7.9, highFrom: 10.9 } as const

// ─── Resting heart rate — NHANES 1999–2008 (NHSR 41, Tables 2–3) ────────────
// A 30-second radial pulse after ~4 min seated rest, ×2. Men have the full
// ladder; women only the quartiles.
export const RHR_NHANES: Record<'male' | 'female', AgeRow<PercentileTable>[]> = {
  male: [
    { min: 20, max: 39, data: [[5, 52], [10, 55], [25, 61], [50, 69], [75, 76], [90, 84], [95, 89]] },
    { min: 40, max: 59, data: [[5, 52], [10, 55], [25, 61], [50, 68], [75, 77], [90, 85], [95, 90]] },
    { min: 60, max: 79, data: [[5, 50], [10, 54], [25, 60], [50, 67], [75, 75], [90, 84], [95, 91]] },
    { min: 80, max: 120, data: [[2.5, 48], [5, 51], [10, 54], [25, 61], [50, 68], [75, 78], [90, 86], [95, 94]] },
  ],
  female: [
    { min: 20, max: 39, data: [[25, 66], [50, 74], [75, 82]] },
    { min: 40, max: 59, data: [[25, 64], [50, 71], [75, 79]] },
    { min: 60, max: 79, data: [[25, 64], [50, 70], [75, 78]] },
  ],
}

// ─── HRV (SDNN) — Voss 2015, 5-minute supine ECG (KORA S4, Tables 5 and 7) ──
export const HRV_VOSS_2015: Record<'male' | 'female', AgeRow<{ mean: number; sd: number }>[]> = {
  male: [
    { min: 25, max: 34, data: { mean: 50.0, sd: 20.9 } },
    { min: 35, max: 44, data: { mean: 44.6, sd: 16.8 } },
    { min: 45, max: 54, data: { mean: 36.8, sd: 14.6 } },
    { min: 55, max: 64, data: { mean: 32.8, sd: 14.7 } },
    { min: 65, max: 74, data: { mean: 29.6, sd: 13.2 } },
  ],
  female: [
    { min: 25, max: 34, data: { mean: 48.7, sd: 19.0 } },
    { min: 35, max: 44, data: { mean: 45.4, sd: 20.5 } },
    { min: 45, max: 54, data: { mean: 36.9, sd: 13.8 } },
    { min: 55, max: 64, data: { mean: 30.6, sd: 12.4 } },
    { min: 65, max: 74, data: { mean: 27.8, sd: 11.8 } },
  ],
}

// ─── Body fat — Gallagher 2000 (provisional, secondary reproduction) ────────
/** `healthyBelow`: healthy while value < this. `overfatMax`: overfat while ≤ this; obese above. */
export interface BodyFatBands { underBelow: number; healthyBelow: number; overfatMax: number }

export const BODY_FAT_GALLAGHER: Record<'male' | 'female', AgeRow<BodyFatBands>[]> = {
  male: [
    { min: 20, max: 39, data: { underBelow: 8,  healthyBelow: 20, overfatMax: 25 } },
    { min: 40, max: 59, data: { underBelow: 11, healthyBelow: 22, overfatMax: 28 } },
    { min: 60, max: 79, data: { underBelow: 13, healthyBelow: 25, overfatMax: 30 } },
  ],
  female: [
    { min: 20, max: 39, data: { underBelow: 21, healthyBelow: 34, overfatMax: 39 } },
    { min: 40, max: 59, data: { underBelow: 23, healthyBelow: 35, overfatMax: 40 } },
    { min: 60, max: 79, data: { underBelow: 24, healthyBelow: 36, overfatMax: 42 } },
  ],
}

// ─── Walking speed — Bohannon 2011, usual pace, m/s ─────────────────────────
// Men only below 80 (the female rows other than 80–99 were not available).
export const WALK_BOHANNON_MEN: AgeRow<number>[] = [
  { min: 20, max: 29, data: 1.36 },
  { min: 30, max: 39, data: 1.43 },
  { min: 40, max: 49, data: 1.43 },
  { min: 50, max: 59, data: 1.43 },
  { min: 60, max: 69, data: 1.34 },
  { min: 70, max: 79, data: 1.26 },
  { min: 80, max: 120, data: 0.97 },
]

/** Pick the source's age band. Outside the table, the nearest band is used
 *  and `clamped` says so, so the UI can label "oldest band available". */
export function rowForAge<T>(rows: AgeRow<T>[], age: number): { row: AgeRow<T>; clamped: boolean } | null {
  if (rows.length === 0) return null
  const hit = rows.find(r => age >= r.min && age <= r.max)
  if (hit) return { row: hit, clamped: false }
  return { row: age < rows[0].min ? rows[0] : rows[rows.length - 1], clamped: true }
}

/** Position of `value` in a percentile ladder, linearly interpolated.
 *  Beyond the ends it extrapolates along the outer segment only when the
 *  ladder reaches the 10th/90th percentile (clamped to 1–99); a quartile-only
 *  ladder returns null outside its range rather than invent a tail. */
export function percentileFromTable(table: PercentileTable, value: number): number | null {
  if (!Number.isFinite(value) || table.length < 2) return null
  const first = table[0]
  const last = table[table.length - 1]
  const lerp = (a: readonly [number, number], b: readonly [number, number]) =>
    b[1] === a[1] ? a[0] : a[0] + ((value - a[1]) / (b[1] - a[1])) * (b[0] - a[0])
  let p: number
  if (value < first[1]) {
    if (first[0] > 10) return null
    p = lerp(first, table[1])
  } else if (value > last[1]) {
    if (last[0] < 90) return null
    p = lerp(table[table.length - 2], last)
  } else {
    const i = table.findIndex((pt, idx) => idx > 0 && value <= pt[1])
    p = lerp(table[i - 1], table[i])
  }
  return Math.min(99, Math.max(1, Math.round(p)))
}

/** Value at a percentile the ladder lists exactly (5, 10, 25, 50, 75, 90, 95). */
export function valueAtPercentile(table: PercentileTable, pct: number): number | null {
  return table.find(([p]) => p === pct)?.[1] ?? null
}
