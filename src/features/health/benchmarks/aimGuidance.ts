// What to aim for, in plain words — the "Aim: …" line on the Overview tiles
// and at the top of every metric explainer. Pure and import-free apart from
// sibling pure modules (scripts/verify-health-benchmarks.cjs).
//
// Every aim follows the same reference `classify` uses, so a tile can't say
// "keep it" under a band that says otherwise. Personal where the data allows:
// resting heart rate and HRV against your own usual, weight against the
// healthy range for your height and your own goal weight.
import { DECIMALS, fmt, round } from './classifyKit'
import { computeBmi } from './classifyBody'
import type { BenchmarkContext, BenchmarkMetric, Classification } from './types'

/** keep = you're there · improve = a step worth taking · watch = a short-term signal. */
export type AimStatus = 'keep' | 'improve' | 'watch'

export interface Aim {
  /** null when there is no value to judge yet. */
  status: AimStatus | null
  /** The line after "Aim:". */
  text: string
  /** Extra sentences for the detail sheet only (the tile stays short). */
  more?: string
}

export type Better = 'lower' | 'higher' | 'range'

export const BETTER_LABEL: Record<Better, string> = {
  lower: 'Lower is better',
  higher: 'Higher is better',
  range: 'A healthy range is best',
}

/** Which way is better, from the metric's own `higherIsBetter`. */
export function betterFor(higherIsBetter: boolean | null): Better {
  return higherIsBetter === true ? 'higher' : higherIsBetter === false ? 'lower' : 'range'
}

/** The two tiles that aren't a single benchmark metric. */
export const TILE_PLAIN = {
  weight:
    'Your body weight as a 7-day average — a single weigh-in swings 1–2 kg with water, salt and food. On its own it can’t tell fat from muscle.',
  exercise:
    'Minutes that get you at least breathing harder (a brisk walk counts), plus the days you train your muscles. WHO’s minimum for health is 150 minutes and 2 strength days a week.',
  vitals:
    'HRV (heart rate variability) is how much the gap between heartbeats varies: above your usual means well rested, below it often follows hard training, short sleep, alcohol, stress or a coming cold. Breathing rate, blood oxygen and wrist temperature are checked overnight against your own usual too.',
} as const

const hm = (hours: number) => {
  const m = Math.round(hours * 60)
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

// ─── Resting heart rate ─────────────────────────────────────────────────────

export function restingHrAim(p: { value: number | null; baselineMedian?: number | null; delta?: number | null }): Aim {
  const { value } = p
  const usual = p.baselineMedian != null ? Math.round(p.baselineMedian) : null
  if (value == null) return { status: null, text: 'under 60 bpm over months, and steady against your own usual.' }
  // Compare the unrounded value — classifyRestingHr does — and round only for
  // display, so 59.6 is "under 60" here just as it is on the band.
  const shown = (edge: number) => (Math.round(value) === edge ? fmt(round(value, 1), 1) : String(Math.round(value)))
  if (p.delta != null && p.delta >= 5 && usual != null) {
    return {
      status: 'watch',
      text: `back to your usual ${usual} bpm — this week is ${Math.round(p.delta)} above it. That is often short sleep, alcohol, heat, illness or hard training; take it easier until it settles, usually within days.`,
    }
  }
  if (value < 60) {
    return {
      status: 'keep',
      text: `stay under 60${usual != null ? ` and near your usual ${usual}` : ''} — this is good, keep it. Two or three cardio sessions a week hold it.`,
    }
  }
  if (value <= 80) {
    return {
      status: 'improve',
      text: `under 60 bpm over the next months (you’re at ${Math.round(value)}). Two or three cardio sessions a week — brisk walking, cycling or running at a pace you can still talk at — lowered it about 6 bpm in studies; 7+ h sleep and less alcohol help too.`,
    }
  }
  return {
    status: 'improve',
    text: `80 bpm or lower first, then under 60 (you’re at ${shown(80)}). Regular cardio, 7+ h sleep and less alcohol are the levers; if it stays over 80 at rest, mention it to a doctor.`,
  }
}

// ─── HRV ────────────────────────────────────────────────────────────────────

export function hrvAim(p: { value: number | null; range: { low: number; high: number } | null }): Aim {
  const { value, range } = p
  const levers = 'Regular cardio, 7+ h sleep, less alcohol and less stress raise it over months.'
  if (value == null || !range) {
    return { status: null, text: `at or above your own usual range (it needs 14 days of readings to set). ${levers}` }
  }
  const usual = `${fmt(range.low)}–${fmt(range.high)} ms`
  if (value < range.low) {
    return {
      status: 'watch',
      text: `back inside your usual ${usual}. Below it usually follows hard training, short sleep, alcohol, stress or a coming cold — take an easier day or two and sleep more; it tends to bounce back.`,
    }
  }
  if (value > range.high) {
    return { status: 'keep', text: `stay at or above your usual ${usual} — above it is a sign of good recovery. Keep it.` }
  }
  return { status: 'keep', text: `stay within or above your usual ${usual} — this is good, keep it. ${levers}` }
}

// ─── Sleep ──────────────────────────────────────────────────────────────────

export function sleepAim(p: { avg7: number | null; wakeSd: number | null }): Aim {
  const { avg7, wakeSd } = p
  if (avg7 == null) return { status: null, text: '7 h or more asleep most nights, with a wake time that moves less than about 30 minutes.' }
  if (avg7 < 7) {
    const gap = Math.max(5, Math.round(((7 - avg7) * 60) / 5) * 5)
    return {
      status: 'improve',
      text: `7 h or more asleep (you average ${hm(avg7)}). Keep a fixed wake time — weekends too — and get to bed about ${gap} min earlier.`,
    }
  }
  if (wakeSd != null && wakeSd > 30) {
    return {
      status: 'improve',
      text: `the same wake time every day, within about ±30 min (yours moves ±${Math.round(wakeSd)} min). You get enough sleep; a steady wake time was linked to longer life even more than length.`,
    }
  }
  return { status: 'keep', text: `7 h+ asleep${wakeSd != null ? ' and a steady wake time' : ''} — this is good, keep it.` }
}

// ─── Steps ──────────────────────────────────────────────────────────────────

export function stepsAim(p: { avg7: number | null; age: number | null }): Aim {
  const target = p.age != null && p.age >= 60 ? 6000 : 8000
  if (p.avg7 == null) return { status: null, text: `about ${fmt(target)} steps a day, where most of the benefit has arrived.` }
  const v = Math.round(p.avg7)
  if (v >= target) return { status: 'keep', text: `${fmt(target)}+ a day — you’re where most of the benefit is. Keep it.` }
  const gap = Math.ceil((target - v) / 100) * 100
  // About 1,000 steps ≈ 10 minutes of walking (benchmarkInfo, step_count).
  const minutes = Math.max(5, Math.round(gap / 100 / 5) * 5)
  return {
    status: 'improve',
    text: `${fmt(target)} a day (you’re at ${fmt(v)}): about ${fmt(gap)} more, roughly ${minutes} min of walking — a walk after meals or part of a commute.`,
  }
}

// ─── Exercise ───────────────────────────────────────────────────────────────

const WORDS = ['no', 'one', 'two', 'three']

export function exerciseAim(p: { minutes7: number | null; strengthDays7: number | null }): Aim {
  const min = p.minutes7 ?? 0
  const days = p.strengthDays7 ?? 0
  if (p.minutes7 == null && p.strengthDays7 == null) return { status: null, text: '150 active minutes and 2 strength days a week.' }
  if (min >= 150 && days >= 2) return { status: 'keep', text: '150+ minutes and 2+ strength days — both met, keep it.' }
  const parts: string[] = []
  if (min < 150) {
    const gap = Math.ceil(150 - min)
    // The suggestion is sized to the gap: a couple of walks close a small one,
    // a big one needs a little every day of the (rolling) week.
    const walks = Math.ceil(gap / 20)
    const how = gap <= 60
      ? `${WORDS[walks]} brisk 20-minute walk${walks === 1 ? ' covers' : 's cover'} it`
      : `about ${Math.ceil(gap / 7 / 5) * 5} brisk minutes a day covers it`
    parts.push(`150 min a week (${fmt(gap)} to go — ${how})`)
  }
  if (days < 2) parts.push(`2 strength days (${2 - days} to go)`)
  return { status: 'improve', text: `${parts.join(' and ')}.` }
}

// ─── Weight ─────────────────────────────────────────────────────────────────

/**
 * The lightest and heaviest one-decimal weights that classifyBmi calls a
 * healthy weight at this height. Found through computeBmi itself (which rounds
 * BMI to one decimal), so the range, the aim and the BMI band can never
 * disagree — 180 cm → 59.8–80.8 kg (BMI 18.5–24.9).
 */
export function healthyWeightRange(heightCm: number | null | undefined): { low: number; high: number } | null {
  if (!heightCm || !Number.isFinite(heightCm) || heightCm < 100 || heightCm > 250) return null
  const h2 = (heightCm / 100) ** 2
  const bmi = (kg: number) => computeBmi(kg, heightCm) as number
  let low = round(Math.ceil(18.45 * h2 * 10) / 10, 1)
  while (bmi(round(low - 0.1, 1)) >= 18.5) low = round(low - 0.1, 1)
  while (bmi(low) < 18.5) low = round(low + 0.1, 1)
  let high = round(Math.floor(24.95 * h2 * 10) / 10, 1)
  while (bmi(round(high + 0.1, 1)) < 25) high = round(high + 0.1, 1)
  while (bmi(high) >= 25) high = round(high - 0.1, 1)
  return { low, high }
}

export type Phase = 'cut' | 'maintain' | 'gain'

/** A kg gap, never shown as "0.0" when there is one. */
const gapKg = (d: number) => fmt(Math.max(0.1, Math.ceil(Math.abs(d) * 10 - 1e-9) / 10), 1)

export function weightAim(p: {
  kg: number | null
  heightCm: number | null | undefined
  goalWeightKg?: number | null
  phase?: Phase | null
  /** Waist-to-height ratio, when a tape measurement exists. */
  whtr?: number | null
  /** False while the goal (and phase) are still loading: nothing is said about them yet. */
  goalLoaded?: boolean
}): Aim {
  const loaded = p.goalLoaded !== false
  const range = healthyWeightRange(p.heightCm)
  const rangeKg = range ? `${fmt(range.low, 1)}–${fmt(range.high, 1)} kg` : ''
  const rangeText = range ? `healthy for ${fmt(p.heightCm as number)} cm is ${rangeKg} (BMI 18.5–24.9)` : null
  const goal = loaded && p.goalWeightKg != null && p.goalWeightKg > 0 ? p.goalWeightKg : null
  const noHeight = 'add your height in the profile to see the healthy weight range for you.'
  const setGoal = loaded ? ' No goal weight yet — set one in Goal progress.' : ''
  if (p.kg == null) return { status: null, text: rangeText ? `${rangeText}.` : noHeight }
  const kg = p.kg
  const pace = loaded && p.phase === 'cut'
    ? `A steady ${fmt(round(kg * 0.005, 1), 1)}–${fmt(round(kg * 0.01, 1), 1)} kg a week (0.5–1% of your weight) keeps muscle while fat comes off.`
    : ''
  const waistCm = p.heightCm ? fmt(Math.round(p.heightCm / 2)) : null
  const waist = waistCm ? `BMI can’t tell muscle from fat, so a waist under half your height (${waistCm} cm) is the better check.` : ''
  const join = (...xs: string[]) => xs.filter(Boolean).join(' ') || undefined
  if (goal != null) {
    const g = fmt(goal, goal % 1 ? 1 : 0)
    const gap = round(kg - goal, 1)
    const ref = rangeText ? `For reference, ${rangeText}.` : ''
    if (Math.abs(gap) <= 0.5) return { status: 'keep', text: `your goal of ${g} kg — you’re there, keep it.`, more: join(ref) }
    return {
      status: 'improve',
      text: `${g} kg, your goal — ${fmt(Math.abs(gap), 1)} kg to ${gap > 0 ? 'lose' : 'gain'}.`,
      more: join(gap > 0 ? pace : '', ref),
    }
  }
  if (!range) return { status: null, text: `${noHeight}${setGoal}` }
  // Decided on the same rounded BMI the tile's band uses.
  const bmi = computeBmi(kg, p.heightCm) as number
  if (bmi < 18.5) return { status: 'improve', text: `${fmt(range.low, 1)} kg or more — ${rangeText}; you’re ${gapKg(range.low - kg)} kg below.${setGoal}` }
  if (bmi < 25) {
    // The weight is fine but a waist of half your height or more is the band the tile shows then.
    if (p.whtr != null && p.whtr >= 0.5) {
      return {
        status: 'improve',
        text: `a waist under half your height (${waistCm} cm) — your weight is within ${rangeKg}, the healthy range for your height, but the waist says there is belly fat to lose.${setGoal}`,
        more: join(pace),
      }
    }
    return { status: 'keep', text: `stay within ${rangeKg}, the healthy range for your height — keep it.${setGoal}` }
  }
  // BMI can't tell muscle from fat: a healthy waist says the extra is likely muscle.
  if (p.whtr != null && p.whtr < 0.5) {
    return { status: 'keep', text: `${rangeText}, but your waist is under half your height, so the extra is likely muscle — keep the waist there.${setGoal}` }
  }
  return {
    status: 'improve',
    text: `${fmt(range.high, 1)} kg or less — ${rangeText}; you’re ${gapKg(kg - range.high)} kg above.${setGoal}`,
    more: join(waist, pace),
  }
}

// ─── Overnight vitals ───────────────────────────────────────────────────────

/** "Blood oxygen" → "blood oxygen"; an acronym (HRV) keeps its capitals. */
const lowerLabel = (l: string) => (l === l.toUpperCase() ? l : l.charAt(0).toLowerCase() + l.slice(1))

/** The overnight-vitals tile: two or more readings off together is the pattern
 *  worth acting on; otherwise the tile's headline number (HRV) leads.
 *  `outside` lists only readings off in their CONCERNING direction
 *  (summarizeVitals leaves out HRV above its range, a good sign), so this aim
 *  never asks you to bring a good HRV down. */
export function vitalsAim(p: { checked: number; outside: readonly string[]; hrv?: Aim | null }): Aim {
  // Belt and braces: an HRV the HRV aim calls fine can only be off upwards.
  const outside = p.hrv?.status === 'keep' ? p.outside.filter(l => l !== 'HRV') : p.outside
  if (outside.length >= 2) {
    const list = outside.map(lowerLabel).join(' and ')
    return {
      status: 'watch',
      text: `back inside your usual range: ${list} are off together. That pattern often comes before a cold or after a hard stretch — take it easy, sleep more and watch how you feel.`,
    }
  }
  if (p.hrv && p.hrv.status != null && (p.hrv.status !== 'keep' || outside.length === 0)) return p.hrv
  if (outside.length === 1) {
    return { status: 'keep', text: `${lowerLabel(outside[0])} is outside your usual range; one on its own is common (a late meal, alcohol, a hard session) and means little.` }
  }
  if (p.checked === 0) return p.hrv ?? { status: null, text: 'every reading inside your own usual range — it needs a couple of weeks of nights to set.' }
  return { status: 'keep', text: 'all inside your usual range — nothing to act on. Keep it.' }
}

// ─── Any other metric: from its classification ──────────────────────────────

const HOW: Partial<Record<BenchmarkMetric, string>> = {
  vo2_max: 'Three cardio sessions a week for 8–12 weeks, one or two of them intervals, typically add 3–6 ml/kg/min.',
  body_fat_percentage: 'A modest calorie deficit with enough protein and regular lifting takes it down while keeping muscle.',
  bmi: 'For a lifter, check waist-to-height too — BMI can’t tell muscle from fat.',
  waist_to_height: 'A calorie deficit plus regular cardio and lifting takes belly fat down first.',
  weekly_exercise_minutes: 'Brisk walks, cycling or intervals all count.',
  strength_days: 'Two full-body sessions a week cover it.',
  strength_minutes: 'Two short sessions a week are enough for the health benefit.',
  heart_rate_recovery: 'Aerobic training improves it; compare similar hard workouts.',
  walking_speed: 'Leg strength and a daily walk keep it up.',
  respiratory_rate: 'Not a training target — a clear rise above your usual is the signal to rest.',
  blood_oxygen: 'Not a training target — re-measure a low reading with the watch snug and still.',
  sleep_regularity: 'Wake at the same time every day, weekends too.',
  step_count: 'A walk after meals or part of a commute adds up.',
  sleep_duration: 'Keep a fixed wake time and move bedtime earlier.',
  resting_heart_rate: 'Regular cardio, enough sleep and less alcohol lower it.',
  heart_rate_variability: 'Regular cardio, enough sleep and less alcohol and stress raise it.',
}

/** The generic aim: "keep it" on a success band, else the classification's next step. */
export function aimFromClassification(metric: BenchmarkMetric, cls: Classification | null, unit: string): Aim {
  const how = HOW[metric] ?? ''
  if (!cls) return { status: null, text: how || 'see the reference ladder below.' }
  if (cls.tone === 'success') return { status: 'keep', text: `stay where you are — ${lowerLabel(cls.label)}. This is good, keep it.` }
  if (cls.nextStep) {
    const gap = cls.nextStep.gap
    const u = unit === '%' ? ' percentage points' : metric === 'waist_to_height' ? '' : ` ${unit}`
    const toGo = gap > 0 ? ` — ${fmt(gap, DECIMALS[metric])}${u} to go` : ''
    return { status: 'improve', text: `${cls.nextStep.label}${toGo}.${how ? ` ${how}` : ''}` }
  }
  return { status: cls.tone === 'warn' ? 'watch' : null, text: how || cls.label }
}

/** Aim for a benchmark metric: the personal version where one exists, else the generic one. */
export function aimFor(metric: BenchmarkMetric, value: number | null, cls: Classification | null, ctx: BenchmarkContext, unit: string): Aim {
  switch (metric) {
    case 'resting_heart_rate': return restingHrAim({ value })
    case 'heart_rate_variability':
      return hrvAim({ value, range: ctx.baseline?.sd != null ? { low: ctx.baseline.mean - ctx.baseline.sd, high: ctx.baseline.mean + ctx.baseline.sd } : null })
    case 'step_count': return stepsAim({ avg7: value, age: ctx.age })
    case 'sleep_duration': return sleepAim({ avg7: value, wakeSd: null })
    default: return aimFromClassification(metric, cls, unit)
  }
}
