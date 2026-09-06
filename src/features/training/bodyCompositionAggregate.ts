import type { BodyCompositionReport } from './api/bodyCompositionApi'

// Pure aggregation for the smart-scale body-composition reports UI (Training
// → Health → Body). No React, no Supabase — sucrase-verifiable per this
// repo's no-unit-test-framework convention (scripts/verify-*.cjs).

export type BodyCompFieldKey =
  | 'weight_kg' | 'body_fat_percent' | 'body_fat_mass_kg' | 'lean_body_mass_kg'
  | 'body_water_percent' | 'protein_percent' | 'muscle_percent'
  | 'skeletal_muscle_percent' | 'skeletal_muscle_index' | 'bmi'
  | 'visceral_fat_index' | 'subcutaneous_fat_kg' | 'bmr_kcal' | 'body_score'

export interface BodyCompFieldMeta {
  key: BodyCompFieldKey
  label: string
  unit: string
  decimals: number
  icon: string
  color: string
}

// One persistent colour per field (reused whether it's the featured trend
// chart or a stat-grid accent dot) — never reassigned when the picker
// switches, since each trend chart only ever shows ONE series at a time (no
// legend, no adjacent-pair identity problem to validate). Weight/Body Fat/
// BMI/Lean Mass reuse the exact hues BodySection already uses for the SAME
// metric name read from Apple Health — same metric identity, different
// source, never shown side by side, so reusing the hue aids recognition
// rather than risking confusion. visceral_fat_index deliberately does NOT
// get a red/alarm colour — this table stores the report's numbers, never the
// device's own risk judgment (see the migration's own header comment).
export const BODY_COMP_FIELDS: BodyCompFieldMeta[] = [
  { key: 'weight_kg',               label: 'Weight',            unit: 'kg',   decimals: 1, icon: '⚖️', color: '#7c3aed' },
  { key: 'body_fat_percent',        label: 'Body Fat',          unit: '%',    decimals: 1, icon: '📏', color: '#f59e0b' },
  { key: 'body_fat_mass_kg',        label: 'Fat Mass',          unit: 'kg',   decimals: 1, icon: '🧈', color: '#ea580c' },
  { key: 'lean_body_mass_kg',       label: 'Lean Mass',         unit: 'kg',   decimals: 1, icon: '💪', color: '#16a34a' },
  { key: 'body_water_percent',      label: 'Body Water',        unit: '%',    decimals: 1, icon: '💧', color: '#0891b2' },
  { key: 'protein_percent',         label: 'Protein',           unit: '%',    decimals: 1, icon: '🥚', color: '#db2777' },
  { key: 'muscle_percent',          label: 'Muscle',             unit: '%',    decimals: 1, icon: '🏋️', color: '#059669' },
  { key: 'skeletal_muscle_percent', label: 'Skeletal Muscle',   unit: '%',    decimals: 1, icon: '🦴', color: '#0d9488' },
  { key: 'skeletal_muscle_index',   label: 'Skeletal Muscle Index', unit: '', decimals: 1, icon: '📊', color: '#4f46e5' },
  { key: 'bmi',                     label: 'BMI',                unit: '',    decimals: 1, icon: '📐', color: '#0ea5e9' },
  { key: 'visceral_fat_index',      label: 'Visceral Fat Index', unit: '',    decimals: 0, icon: '🎯', color: '#a16207' },
  { key: 'subcutaneous_fat_kg',     label: 'Subcutaneous Fat',   unit: 'kg',  decimals: 1, icon: '🧊', color: '#d97706' },
  { key: 'bmr_kcal',                label: 'BMR',                unit: 'kcal', decimals: 0, icon: '🔥', color: '#2563eb' },
  { key: 'body_score',              label: 'Body Score',         unit: '/100', decimals: 0, icon: '🏆', color: '#7c2d12' },
]

export function fieldMeta(key: BodyCompFieldKey): BodyCompFieldMeta {
  const m = BODY_COMP_FIELDS.find(f => f.key === key)
  if (!m) throw new Error(`Unknown body composition field: ${key}`)
  return m
}

// Reports come back ascending by measured_at from the API; this re-sorts
// defensively so every function below can rely on chronological order
// without trusting the caller.
function sortedAsc(reports: BodyCompositionReport[]): BodyCompositionReport[] {
  return [...reports].sort((a, b) => a.measured_at.localeCompare(b.measured_at))
}

export function filterSince(reports: BodyCompositionReport[], sinceMs: number): BodyCompositionReport[] {
  return reports.filter(r => new Date(r.measured_at).getTime() >= sinceMs)
}

// Window chips for the featured trend chart / averages — 'all' never filters
// (an empty/short history should never look broken by an over-eager cutoff).
export type BodyCompWindow = '30d' | '90d' | '365d' | 'all'
export const BODY_COMP_WINDOWS: { key: BodyCompWindow; label: string; days: number | null }[] = [
  { key: '30d',  label: '30D',  days: 30 },
  { key: '90d',  label: '90D',  days: 90 },
  { key: '365d', label: '1Y',   days: 365 },
  { key: 'all',  label: 'All',  days: null },
]

export function reportsInWindow(reports: BodyCompositionReport[], window: BodyCompWindow, referenceMs: number = Date.now()): BodyCompositionReport[] {
  const sorted = sortedAsc(reports)
  const days = BODY_COMP_WINDOWS.find(w => w.key === window)?.days ?? null
  if (days == null) return sorted
  return filterSince(sorted, referenceMs - days * 86_400_000)
}

// The two most recent scans (chronological order preserved: [older, newer]).
// null/null on an empty history, [null, only] with exactly one scan so far.
export function latestAndPrevious(reports: BodyCompositionReport[]): {
  latest: BodyCompositionReport | null
  previous: BodyCompositionReport | null
} {
  const sorted = sortedAsc(reports)
  const latest = sorted[sorted.length - 1] ?? null
  const previous = sorted.length >= 2 ? sorted[sorted.length - 2] : null
  return { latest, previous }
}

export interface FieldDelta { delta: number; deltaPercent: number | null }

// null when either scan is missing — never a fabricated "0 change".
export function deltaFor(latest: BodyCompositionReport | null, previous: BodyCompositionReport | null, key: BodyCompFieldKey): FieldDelta | null {
  if (!latest || !previous) return null
  const a = previous[key], b = latest[key]
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) return null
  const delta = b - a
  const deltaPercent = a !== 0 ? (delta / Math.abs(a)) * 100 : null
  return { delta, deltaPercent }
}

// Plain arithmetic mean over whatever's in `reports` — the caller decides the
// window (reportsInWindow) first. null on an empty set, never 0 (a 0 average
// would look like a real reading of zero rather than "no data").
export function average(reports: BodyCompositionReport[], key: BodyCompFieldKey): number | null {
  const vals = reports.map(r => r[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export interface TrendResult {
  direction: 'up' | 'down' | 'flat'
  // Least-squares slope, expressed as change per 7 days — a plain descriptive
  // rate, not a claim about whether that direction is good (a field like
  // weight or fat mass isn't inherently "better" trending either way; that
  // depends on the person's own goal, which this table has no concept of).
  perWeek: number
  firstValue: number
  lastValue: number
}

// A flat least-squares fit over (days-since-first-point, value) — the same
// "read the trend over sessions, not the last single reading" idea used
// throughout Training's Progress tab, scaled down to this table's own scans.
// Requires >=2 points with a real time spread; otherwise null rather than a
// meaningless single-point "trend".
const FLAT_SLOPE_PER_WEEK_EPSILON = 1e-6
export function computeTrend(reports: BodyCompositionReport[], key: BodyCompFieldKey): TrendResult | null {
  const sorted = sortedAsc(reports).filter(r => typeof r[key] === 'number' && Number.isFinite(r[key] as number))
  if (sorted.length < 2) return null
  const t0 = new Date(sorted[0].measured_at).getTime()
  const points = sorted.map(r => ({
    x: (new Date(r.measured_at).getTime() - t0) / 86_400_000, // days since first point
    y: r[key] as number,
  }))
  const spanDays = points[points.length - 1].x
  if (spanDays <= 0) return null // all scans on the same instant — no real time spread

  const n = points.length
  const sumX = points.reduce((a, p) => a + p.x, 0)
  const sumY = points.reduce((a, p) => a + p.y, 0)
  const meanX = sumX / n, meanY = sumY / n
  const num = points.reduce((a, p) => a + (p.x - meanX) * (p.y - meanY), 0)
  const den = points.reduce((a, p) => a + (p.x - meanX) ** 2, 0)
  const slopePerDay = den !== 0 ? num / den : 0
  const perWeek = slopePerDay * 7

  return {
    direction: Math.abs(perWeek) < FLAT_SLOPE_PER_WEEK_EPSILON ? 'flat' : perWeek > 0 ? 'up' : 'down',
    perWeek,
    firstValue: points[0].y,
    lastValue: points[points.length - 1].y,
  }
}
