// Small shared helpers for the per-metric classifiers. Import-free apart from types.
import type { BenchmarkMetric, BenchmarkTone, Classification, NextStep, Sex, Source } from './types'

/** Display precision per metric, in the metric's own unit. */
export const DECIMALS: Record<BenchmarkMetric, number> = {
  vo2_max: 1,
  resting_heart_rate: 0,
  heart_rate_variability: 0,
  step_count: 0,
  sleep_duration: 1,
  sleep_regularity: 0,
  body_fat_percentage: 1,
  bmi: 1,
  waist_to_height: 2,
  weekly_exercise_minutes: 0,
  strength_days: 0,
  strength_minutes: 0,
  heart_rate_recovery: 0,
  walking_speed: 1,
  respiratory_rate: 1,
  blood_oxygen: 0,
}

export function round(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

/** en-GB number with thousands separators: 8000 → "8,000", 37.8 → "37.8". */
export function fmt(v: number, decimals = 0): string {
  return v.toLocaleString('en-GB', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Adult reference tables only: a missing or under-18 age counts as "unknown". */
export function adultAge(age: number | null | undefined): number | null {
  return age != null && Number.isFinite(age) && age >= 18 ? Math.floor(age) : null
}

export function sexWord(sex: Sex): string {
  return sex === 'male' ? 'Men' : 'Women'
}

/** "40–49", "80+" — plus a note when the person's age lies outside the source's bands. */
export function ageBandName(min: number, max: number, clamped: boolean): string {
  const name = max >= 100 ? `${min}+` : `${min}–${max}`
  return clamped ? `${name} (nearest band in the source)` : name
}

export function nextStep(metric: BenchmarkMetric, label: string, target: number, value: number): NextStep {
  const d = DECIMALS[metric]
  return { label, target: round(target, d), gap: round(Math.abs(target - value), d) }
}

export interface BandSpec {
  band: string
  label: string
  tone: BenchmarkTone
}

export function build(
  metric: BenchmarkMetric,
  spec: BandSpec,
  rest: {
    percentile?: number | null
    referenceText: string
    nextStep?: NextStep | null
    meaning: string
    sources: Source[]
  },
): Classification {
  return {
    metric,
    band: spec.band,
    label: spec.label,
    tone: spec.tone,
    percentile: rest.percentile ?? null,
    referenceText: rest.referenceText,
    nextStep: rest.nextStep ?? null,
    meaning: rest.meaning,
    sources: rest.sources,
  }
}
