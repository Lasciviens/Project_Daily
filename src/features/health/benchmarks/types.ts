// Shared types for the Health reference ranges. Import-free.
import type { Source } from './sources'

export type { Source }

export type Sex = 'male' | 'female'

/** The three profile fields reference ranges need (athlete_profile, migration 110). */
export interface HealthProfile {
  birthYear: number | null
  sex: Sex | null
  heightCm: number | null
}

export type BenchmarkMetric =
  | 'vo2_max'
  | 'resting_heart_rate'
  | 'heart_rate_variability'
  | 'step_count'
  | 'sleep_duration'
  | 'sleep_regularity'
  | 'body_fat_percentage'
  | 'bmi'
  | 'waist_to_height'
  | 'weekly_exercise_minutes'
  | 'strength_days'
  | 'strength_minutes'
  | 'heart_rate_recovery'
  | 'walking_speed'
  | 'respiratory_rate'
  | 'blood_oxygen'

/** A subset of the app's `Tone` (src/shared/ui/Tone.tsx), so it can be passed
 *  straight to `<TonePill tone>`. 'warn' — not 'warning' — is the app's name. */
export type BenchmarkTone = 'danger' | 'warn' | 'neutral' | 'success' | 'info'

export interface NextStep {
  /** What the next band is called, e.g. "Average for your age (50th percentile)". */
  label: string
  /** Value that reaches it, in the metric's own unit. */
  target: number
  /** Distance still to go, always ≥ 0, in the metric's own unit. */
  gap: number
}

export interface Classification {
  metric: BenchmarkMetric
  /** Stable band id, e.g. 'below_average', 'healthy', 'plateau'. */
  band: string
  /** Short user-facing band name. */
  label: string
  tone: BenchmarkTone
  /**
   * Position in the reference population: the share of that population with
   * a LOWER value, 1–99, approximate. For metrics where lower is better
   * (resting heart rate) a low percentile is good — see BENCHMARKS[m].higherIsBetter.
   * Null when no population distribution applies.
   */
  percentile: number | null
  /** The comparison used, e.g. "Men 40–49: average 37.8, middle half 31.9–45.0 ml/kg/min (FRIEND 2015)". */
  referenceText: string
  nextStep: NextStep | null
  /** Plain words: what the band means and what the evidence links it to. */
  meaning: string
  sources: Source[]
}

export interface BenchmarkContext {
  age: number | null
  sex: Sex | null
  /** A personal baseline (e.g. the 60-day mean ± SD). HRV and respiratory rate use it. */
  baseline?: { mean: number; sd?: number | null } | null
  /** Lets BMI and waist-to-height next steps name a weight / waist in kg / cm. */
  heightCm?: number | null
}

export interface BenchmarkInfo {
  title: string
  unit: string
  /** One plain sentence: what the short name stands for and what it means in everyday life. */
  plain: string
  whatItMeans: string
  howToImprove: string
  caveats: string
  sources: Source[]
  /** true: higher is better · false: lower is better · null: a range is best. */
  higherIsBetter: boolean | null
  /** How firm the reference itself is (primary table verified = high). */
  confidence: 'high' | 'medium' | 'low'
}
