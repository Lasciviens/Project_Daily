// Health reference ranges — the one public entry point. PURE and import-free
// (only sibling pure modules), so scripts/verify-health-benchmarks.cjs can
// load it through sucrase.
//
//   classify(metric, value, { age, sex })  → where a value sits against a cited reference
//   vo2Explain(value, { age, sex })        → the richer VO2 max read for the hero tile
//   BENCHMARKS[metric]                     → what it means / how to improve / caveats / sources
//
// Every band is built from the fact-checked research (2026-09): FRIEND 2015
// (VO2 max), NHANES (resting HR), Voss 2015 (HRV), Paluch 2022 (steps),
// AASM/SRS + Windred 2024 (sleep), Gallagher 2000 (body fat), GBMC 2016 + NICE
// (BMI, waist-to-height), WHO 2020 + Arem 2015 + Momma 2022 (activity),
// Cole 1999 (cardio recovery), Studenski 2011 + Bohannon 2011 (walking speed),
// Natarajan 2021 (respiratory rate) and WHO (blood oxygen). Population
// evidence is always phrased as an association, never a diagnosis.
import { SRC } from './sources'
import { VO2_FRIEND_2015, VO2_HUNT3_MEN, rowForAge, valueAtPercentile } from './referenceTables'
import { adultAge, ageBandName, fmt, round, sexWord } from './classifyKit'
import {
  classifyBloodOxygen, classifyHeartRateRecovery, classifyHrv, classifyRespiratoryRate, classifyRestingHr, classifyVo2,
} from './classifyCardio'
import {
  classifySleepDuration, classifySleepRegularity, classifySteps, classifyStrengthDays, classifyStrengthMinutes,
  classifyWalkingSpeed, classifyWeeklyExercise,
} from './classifyActivity'
import { classifyBmi, classifyBodyFat, classifyWaistToHeight } from './classifyBody'
import type { BenchmarkContext, BenchmarkMetric, Classification, HealthProfile, Sex, Source } from './types'

export type {
  BenchmarkContext, BenchmarkInfo, BenchmarkMetric, BenchmarkTone, Classification, HealthProfile, NextStep, Sex, Source,
} from './types'
export { BENCHMARKS } from './benchmarkInfo'
export {
  BETTER_LABEL, TILE_PLAIN, aimFor, aimFromClassification, betterFor, exerciseAim, healthyWeightRange, hrvAim,
  restingHrAim, sleepAim, stepsAim, vitalsAim, weightAim,
} from './aimGuidance'
export type { Aim, AimStatus, Better, Phase } from './aimGuidance'
export { computeBmi, computeWaistToHeight } from './classifyBody'
export { moderateEquivalentMinutes } from './classifyActivity'
export { normalizeSpo2 } from './classifyCardio'

// ─── Profile → context ──────────────────────────────────────────────────────

/** Maps an athlete_profile row (or anything shaped like one) to the three health fields. */
export function toHealthProfile(
  row: { birth_year?: number | string | null; sex?: string | null; height_cm?: number | string | null } | null | undefined,
): HealthProfile {
  const num = (v: unknown) => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const sex = row?.sex === 'male' || row?.sex === 'female' ? (row.sex as Sex) : null
  return { birthYear: num(row?.birth_year), sex, heightCm: num(row?.height_cm) }
}

/**
 * Age in whole years on `todayIso` (yyyy-MM-dd or a full ISO timestamp).
 * Only the birth YEAR is stored, so this is the age reached this calendar
 * year — up to one year high before the birthday, harmless for decade bands.
 */
export function ageOn(profile: Pick<HealthProfile, 'birthYear'> | null | undefined, todayIso: string): number | null {
  const birthYear = profile?.birthYear
  const year = Number(todayIso.slice(0, 4))
  if (birthYear == null || !Number.isInteger(birthYear) || !Number.isInteger(year)) return null
  const age = year - birthYear
  return age >= 0 && age <= 120 ? age : null
}

/** The context `classify` needs, straight from a profile. */
export function contextFor(profile: HealthProfile | null | undefined, todayIso: string): BenchmarkContext {
  return { age: ageOn(profile, todayIso), sex: profile?.sex ?? null, heightCm: profile?.heightCm ?? null }
}

/** Apple Health / Health Auto Export metric name → benchmark (plus a unit note where one differs). */
export const HEALTH_METRIC_BENCHMARK: Readonly<Record<string, BenchmarkMetric>> = {
  vo2_max: 'vo2_max',
  resting_heart_rate: 'resting_heart_rate',
  heart_rate_variability: 'heart_rate_variability',
  step_count: 'step_count',
  body_fat_percentage: 'body_fat_percentage',
  body_mass_index: 'bmi',
  cardio_recovery: 'heart_rate_recovery',
  walking_speed: 'walking_speed', // km/h, as exported
  respiratory_rate: 'respiratory_rate',
  blood_oxygen_saturation: 'blood_oxygen', // % (a 0–1 fraction is accepted too)
}

// ─── classify ───────────────────────────────────────────────────────────────

/**
 * Where `value` sits against the cited reference for `metric`.
 * Returns null for a non-finite or negative value, and where no honest
 * reference exists without more context (body fat without sex; HRV with
 * neither a personal baseline nor an age).
 * Units: VO2 ml/kg/min · resting HR bpm · HRV ms · steps/day · sleep h/night ·
 * sleep regularity = SD of wake time in min · body fat % · BMI · waist-to-height
 * ratio · activity moderate-equivalent min/week · strength days/week ·
 * strength min/week · cardio recovery bpm · walking speed km/h ·
 * respiratory breaths/min · blood oxygen %.
 */
export function classify(metric: BenchmarkMetric, value: number, ctx: BenchmarkContext): Classification | null {
  if (!Number.isFinite(value) || value < 0) return null
  switch (metric) {
    case 'vo2_max': return classifyVo2(value, ctx)
    case 'resting_heart_rate': return classifyRestingHr(value, ctx)
    case 'heart_rate_variability': return classifyHrv(value, ctx)
    case 'step_count': return classifySteps(value, ctx)
    case 'sleep_duration': return classifySleepDuration(value, ctx)
    case 'sleep_regularity': return classifySleepRegularity(value)
    case 'body_fat_percentage': return classifyBodyFat(value, ctx)
    case 'bmi': return classifyBmi(value, ctx)
    case 'waist_to_height': return classifyWaistToHeight(value, ctx)
    case 'weekly_exercise_minutes': return classifyWeeklyExercise(value)
    case 'strength_days': return classifyStrengthDays(value)
    case 'strength_minutes': return classifyStrengthMinutes(value)
    case 'heart_rate_recovery': return classifyHeartRateRecovery(value)
    case 'walking_speed': return classifyWalkingSpeed(value, ctx)
    case 'respiratory_rate': return classifyRespiratoryRate(value, ctx)
    case 'blood_oxygen': return classifyBloodOxygen(value)
  }
}

// ─── Heart-rate helpers ─────────────────────────────────────────────────────

/** Tanaka 2001: HRmax ≈ 208 − 0.7 × age (independent of sex and training status). */
export function estimatedMaxHr(age: number | null | undefined): number | null {
  const a = adultAge(age)
  return a == null ? null : Math.round(208 - 0.7 * a)
}

export interface HeartRateZones {
  hrMax: number
  /** ACSM 2011 moderate: 64–76% of HRmax. */
  moderate: [number, number]
  /** ACSM 2011 vigorous: 77–95% of HRmax. */
  vigorous: [number, number]
  /** Helgerud 2007 4×4 intervals: 90–95% of HRmax. */
  intervals: [number, number]
}

export function heartRateZones(age: number | null | undefined): HeartRateZones | null {
  const hrMax = estimatedMaxHr(age)
  if (hrMax == null) return null
  const at = (p: number) => Math.round(hrMax * p)
  return { hrMax, moderate: [at(0.64), at(0.76)], vigorous: [at(0.77), at(0.95)], intervals: [at(0.9), at(0.95)] }
}

/** Mifflin–St Jeor resting energy (kcal/day) — a sanity line for Apple's basal energy. */
export function expectedRestingEnergyKcal(p: {
  weightKg: number | null | undefined; heightCm: number | null | undefined; age: number | null | undefined; sex: Sex | null | undefined
}): number | null {
  const age = adultAge(p.age)
  if (!p.weightKg || !p.heightCm || age == null || !p.sex) return null
  const base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * age
  return Math.round(base + (p.sex === 'male' ? 5 : -161))
}

export function mlKgMinToMets(v: number): number {
  return round(v / 3.5, 1)
}

// ─── VO2 max explained (hero tile) ──────────────────────────────────────────

export interface Vo2Gap {
  mlKgMin: number
  mets: number
  /** The observational risk gradient for closing the gap (Kodama: RR 0.87 per MET). */
  riskText: string
}

export interface Vo2Explanation {
  value: number
  mets: number
  classification: Classification
  percentile: number | null
  category: string
  /** "Men 40–49", or null without age and sex. */
  ageGroup: string | null
  /** FRIEND 2015 50th percentile for the age group. */
  average: number | null
  /** FRIEND 2015 75th percentile — "good" for the age group. */
  good: number | null
  /** Healthy Norwegian volunteers (HUNT3), men only. */
  norwegianAverage: { mean: number; sd: number | null; percentile: number | null; label: string } | null
  gapToAverage: Vo2Gap | null
  gapToGood: Vo2Gap | null
  /** ± typical watch error — not a confidence interval. */
  watchBand: { low: number; high: number }
  watchCaveat: string
  expectedGain: { low: number; high: number; text: string }
  timeFrame: string
  plan: string
  /** Same absolute oxygen uptake at the target weight (per-kg arithmetic), when both weights are given. */
  atTargetWeight: number | null
  sources: Source[]
}

const WATCH_ERROR = 7

function gapFor(value: number, target: number | null): Vo2Gap | null {
  if (target == null || value >= target) return null
  const ml = round(target - value, 1)
  const mets = round(ml / 3.5, 1)
  const lower = Math.round((1 - 0.87 ** mets) * 100)
  return {
    mlKgMin: ml,
    mets,
    riskText: `Closing it (+${fmt(mets, 1)} METs) is linked to roughly ${lower}% lower all-cause mortality in observational data (Kodama 2009: about 13% per MET) — an association, not a promise.`,
  }
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 erf, |error| < 1.5e-7). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return 0.5 * (1 + Math.sign(z) * erf)
}

export function vo2Explain(
  value: number,
  ctx: BenchmarkContext & { weightKg?: number | null; targetWeightKg?: number | null },
): Vo2Explanation | null {
  const classification = classify('vo2_max', value, ctx)
  if (!classification) return null
  const age = adultAge(ctx.age)
  const pick = age != null && ctx.sex ? rowForAge(VO2_FRIEND_2015[ctx.sex], age) : null
  const average = pick ? valueAtPercentile(pick.row.data, 50) : null
  const good = pick ? valueAtPercentile(pick.row.data, 75) : null
  const ageGroup = pick && ctx.sex ? `${sexWord(ctx.sex)} ${ageBandName(pick.row.min, pick.row.max, pick.clamped)}` : null

  let norwegianAverage: Vo2Explanation['norwegianAverage'] = null
  if (age != null && ctx.sex === 'male') {
    const hunt = rowForAge(VO2_HUNT3_MEN, age)
    if (hunt && !hunt.clamped) {
      const { mean, sd } = hunt.row.data
      const pct = sd ? Math.min(99, Math.max(1, Math.round(normalCdf((value - mean) / sd) * 100))) : null
      norwegianAverage = {
        mean, sd, percentile: pct,
        label: `Healthy Norwegian men ${hunt.row.min}–${hunt.row.max} (HUNT3): ${fmt(mean, 1)}${sd ? ` ± ${fmt(sd, 1)}` : ''} ml/kg/min`,
      }
    }
  }

  const gapToAverage = gapFor(value, average)
  const gapToGood = gapFor(value, good)
  const hr = heartRateZones(age)
  const hrLine = hr ? ` Your estimated max heart rate is about ${hr.hrMax} bpm (208 − 0.7 × age), so 90–95% is ${hr.intervals[0]}–${hr.intervals[1]} bpm.` : ''

  // Distance to the age average; without age/sex, to the next Kodama line.
  const gap = average != null ? (gapToAverage?.mlKgMin ?? null) : (classification.nextStep?.gap ?? null)
  let timeFrame: string
  if (gap == null) {
    timeFrame =
      `You’re at or above ${average != null ? 'the average for your age' : 'the high-fitness line'}. Two or three cardio sessions a week hold it; the reference averages are about 4 ml/kg/min lower for each decade of age (FRIEND 2022), so holding steady is progress.`
  } else if (gap <= 6) {
    timeFrame =
      'One 8–12-week block of 3 cardio sessions a week, 1–2 of them intervals, typically adds 3–6 ml/kg/min — enough to close most of this gap. If nothing has moved after 12 weeks, add 60–120 minutes a week rather than concluding you don’t respond — in a trial, extra weekly training removed apparent non-response (Montero & Lundby 2017, measured as peak power).'
  } else {
    const blocks = Math.ceil(gap / 4.5)
    timeFrame =
      `At about 3–6 ml/kg/min per 8–12-week block, closing ${fmt(gap, 1)} ml/kg/min likely takes ${blocks} blocks (roughly ${blocks * 2}–${blocks * 3} months), with gains slowing as fitness rises — a rough guide, not a promise.`
  }

  const atTargetWeight = ctx.weightKg && ctx.targetWeightKg && ctx.targetWeightKg > 0
    ? round((value * ctx.weightKg) / ctx.targetWeightKg, 1)
    : null

  return {
    value,
    mets: mlKgMinToMets(value),
    classification,
    percentile: classification.percentile,
    category: classification.label,
    ageGroup,
    average,
    good,
    norwegianAverage,
    gapToAverage,
    gapToGood,
    watchBand: { low: round(Math.max(0, value - WATCH_ERROR), 1), high: round(value + WATCH_ERROR, 1) },
    watchCaveat:
      'Apple Watch estimates VO2 max from outdoor walks, runs and hikes only. In validation studies of mostly fit adults it read 4.5–6.3 ml/kg/min below lab tests on average (Lambe 2025, Lambe 2026, Caserman 2024), with a typical error of about ±7. The gap was larger in fitter people (−7.8 at the 80th percentile and up) and small, not significant, in the lower-fitness subgroup (−2.4); one study found overestimation in poorly fit people. So no correction is applied — read the trend.',
    expectedGain: {
      low: 3,
      high: 6,
      text:
        'Across 28 trials, a training programme added about 4.9 ml/kg/min with endurance work and 5.5 with intervals compared with no training (Milanović 2015), with bigger interval gains at lower starting fitness and in longer programmes. Helgerud’s 4 × 4 intervals added 7.2% in 8 weeks. A realistic expectation for one 8–12-week block is about +3 to +6.',
    },
    timeFrame,
    plan:
      'Three cardio sessions a week for 8–12 weeks: one or two interval sessions — for example 4 × 4 min at 90–95% of max heart rate with 3 easy minutes between, after a 10-minute warm-up (Helgerud 2007) — and the rest steady 30–60-minute sessions. Cycling sits well next to lifting (long running blunted muscle gains more in Wilson 2012). Apple only updates VO2 max from outdoor walks, runs and hikes, so do some of it outside.' +
      hrLine,
    atTargetWeight,
    sources: [
      SRC.friend2015, SRC.friend2022, SRC.hunt3, SRC.kodama2009, SRC.mandsager2018, SRC.milanovic2015, SRC.helgerud2007,
      SRC.montero2017, SRC.wilson2012, SRC.tanaka2001, SRC.lambe2025, SRC.lambe2026, SRC.caserman2024, SRC.appleCardio,
    ],
  }
}
