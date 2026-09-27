// The reference ladder behind a classification: every band `classify` can
// return for this metric and person, in order, with the value range of each.
// Built by PROBING classify across the metric's plausible range, so the ladder
// can never disagree with the band a value actually gets — there is no second
// copy of the thresholds. Pure, import-free apart from sibling pure modules.
import { classify } from './healthBenchmarks'
import { DECIMALS, fmt } from './classifyKit'
import type { BenchmarkContext, BenchmarkMetric, BenchmarkTone } from './types'

export interface LadderStep {
  band: string
  label: string
  tone: BenchmarkTone
  /** First probed value in the band (null = open at the bottom). */
  from: number | null
  /** First value of the NEXT band (null = open at the top). */
  to: number | null
  /** "Under 7,000", "7,000–8,000", "10,000 or more". */
  range: string
  /** The band `value` falls in. */
  current: boolean
}

/** [min, max, step] probed per metric, in the metric's own unit. */
const PROBE: Record<BenchmarkMetric, [number, number, number]> = {
  vo2_max: [10, 75, 0.1],
  resting_heart_rate: [35, 110, 1],
  heart_rate_variability: [5, 150, 1],
  step_count: [0, 20000, 100],
  sleep_duration: [3, 11, 0.05],
  sleep_regularity: [0, 180, 1],
  body_fat_percentage: [3, 50, 0.1],
  bmi: [14, 45, 0.1],
  waist_to_height: [0.3, 0.8, 0.01],
  weekly_exercise_minutes: [0, 1200, 5],
  strength_days: [0, 7, 1],
  strength_minutes: [0, 300, 5],
  heart_rate_recovery: [0, 60, 1],
  walking_speed: [1, 8, 0.05],
  respiratory_rate: [8, 26, 0.1],
  blood_oxygen: [80, 100, 0.5],
}

function probeValues(metric: BenchmarkMetric, ctx: BenchmarkContext): number[] {
  let [min, max, step] = PROBE[metric]
  const b = ctx.baseline
  // HRV and respiratory rate can be read against a personal baseline: probe
  // around it so the ladder shows YOUR range, not the population's.
  if (metric === 'heart_rate_variability' && b?.sd) {
    min = Math.max(0, b.mean - 3 * b.sd); max = b.mean + 3 * b.sd; step = Math.max(0.1, b.sd / 20)
  }
  const out: number[] = []
  const n = Math.round((max - min) / step)
  for (let i = 0; i <= n; i++) out.push(Math.round((min + i * step) * 1000) / 1000)
  return out
}

export function referenceLadder(metric: BenchmarkMetric, ctx: BenchmarkContext, value?: number | null): LadderStep[] {
  const d = DECIMALS[metric]
  const groups: { band: string; label: string; tone: BenchmarkTone; from: number }[] = []
  for (const v of probeValues(metric, ctx)) {
    const c = classify(metric, v, ctx)
    if (!c) continue
    const last = groups[groups.length - 1]
    if (last && last.band === c.band) continue
    groups.push({ band: c.band, label: c.label, tone: c.tone, from: v })
  }
  const currentBand = value != null && Number.isFinite(value) ? classify(metric, value, ctx)?.band ?? null : null
  return groups.map((g, i) => {
    const from = i === 0 ? null : g.from
    const to = i === groups.length - 1 ? null : groups[i + 1].from
    const range = from == null && to == null ? 'Any value'
      : from == null ? `Under ${fmt(to as number, d)}`
      : to == null ? `${fmt(from, d)} or more`
      : `${fmt(from, d)}–${fmt(to, d)}`
    return { band: g.band, label: g.label, tone: g.tone, from, to, range, current: g.band === currentBand }
  })
}
