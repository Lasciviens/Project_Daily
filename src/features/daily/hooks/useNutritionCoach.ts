import { useQuery } from '@tanstack/react-query'
import { useHealthMetricSeries } from '../../training/hooks/useHealthExport'
import { computeDailySeries } from '../../training/healthAggregate'
import { fetchLoggedDates } from '../../recipes/api/foodLogApi'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import type { DayTargets, NutritionGoal } from './useDayTargets'

// ─────────────────────────────────────────────────────────────────────────────
//  Nutrition coaching signals — bodyweight-driven protein targets + an
//  adaptive-calorie nudge from the real weight trend. Reviewed by a dietitian +
//  sports-scientist + strength-coach panel; the guardrails below encode their
//  consensus:
//   • protein 1.6–2.4 g/kg (higher on a cut to spare lean mass in a deficit);
//   • a calorie nudge is offered only when BOTH intake logging AND the weight
//     signal are trustworthy, never below a safety floor, and never stacked
//     before the trend can catch up (a cooldown);
//   • rate targets: cut ~0.5–1.0 %/wk loss, lean-gain ~0.25–0.5 %/wk.
// ─────────────────────────────────────────────────────────────────────────────

// Protein grams per kg BODYWEIGHT by goal (panel-approved). NOTE: g/kg of total
// bodyweight — this over-prescribes slightly for high-body-fat users; if a
// body-fat input is ever added, compute the cut target off fat-free mass.
const PROTEIN_PER_KG: Record<NutritionGoal, number> = { maintain: 1.8, cut: 2.4, gain: 1.8 }

const WEIGHT_WINDOW_DAYS = 28
const CONSISTENCY_WINDOW_DAYS = 7
const CONSISTENCY_MIN_DAYS = 4     // ≥4 of last 7 logged → intake data trustworthy
const MIN_WEIGH_INS = 10           // ≥10 distinct weigh-ins in the window → trend trustworthy
const MIN_SPAN_DAYS = 14           // …spread over ≥2 weeks (not 10 readings in 2 days)
const COOLDOWN_DAYS = 14           // wait ≥2 weeks after an adjust before the next
const CAL_FLOOR_ABS = 1500         // never recommend below this (clinical minimum)
const CAL_FLOOR_PER_KG = 24        // …or ~RMR-protecting 24 kcal/kg, whichever is higher
const FAT_FLOOR_PER_KG = 0.6       // hormonal-health fat minimum, matters most on a cut
const PROTEIN_PER_MEAL_PER_KG = 0.4 // ~0.4 g/kg per meal maximises the MPS response

const round5 = (n: number) => Math.round(n / 5) * 5

// Least-squares slope (kg/day) of a daily weight series, ×7 → kg/week. Needs
// ≥2 distinct days; robust to gaps (uses each day's index within the window).
function trendKgPerWeek(series: { date: string; value: number }[]): number | null {
  if (series.length < 2) return null
  const t0 = new Date(series[0].date + 'T00:00:00').getTime()
  const day = 86_400_000
  const xs = series.map(s => (new Date(s.date + 'T00:00:00').getTime() - t0) / day)
  const ys = series.map(s => s.value)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  if (den === 0) return null
  return (num / den) * 7
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return Infinity
  const then = new Date(dateStr + 'T00:00:00').getTime()
  if (!Number.isFinite(then)) return Infinity
  return Math.floor((Date.now() - then) / 86_400_000)
}

export interface CalorieAdvice { delta: number; reason: string }

export interface NutritionCoach {
  weightKg:        number | null
  proteinByGoal:   Record<NutritionGoal, number>
  proteinForGoal:  number | null
  proteinPerMealG: number | null
  fatFloorG:       number | null   // only when goal === 'cut'
  calorieFloor:    number
  trendKgPerWeek:  number | null
  loggedDays7:     number
  consistent:      boolean
  weighIns:        number
  weighInsOk:      boolean
  inCooldown:      boolean
  cooldownDaysLeft: number
  calorieAdvice:   CalorieAdvice | null
  onTrack:         string | null   // green confirmation text when dialled in
  atFloor:         boolean          // a cut is warranted but we're at the floor
}

// `targets` is passed in (NOT read via useDayTargets) so goal/calories/cooldown
// always reflect the single source of truth in NutritionCard — useDayTargets is
// per-instance local state, so a second instance here would go stale.
export function useNutritionCoach(date: string, targets: DayTargets): NutritionCoach {
  const { goal } = targets
  const from = shiftDateStr(date, -WEIGHT_WINDOW_DAYS)
  const { data: wPts = [] } = useHealthMetricSeries('weight_body_mass', from, date)
  const { data: loggedDates = [] } = useQuery({
    queryKey: ['food-log', 'logged-dates', date],
    queryFn:  () => fetchLoggedDates(shiftDateStr(date, -(CONSISTENCY_WINDOW_DAYS - 1)), date),
    staleTime: 5 * 60_000,
  })

  const wSeries = computeDailySeries('weight_body_mass', wPts)
  let weightKg = wSeries.length ? wSeries[wSeries.length - 1].value : null
  // Sanity guard: weight_body_mass is assumed kg (Health Auto Export can emit
  // imperial by locale — same class as the documented kJ/kcal bug). A value
  // this large can't be a human weight in kg, so don't derive targets from it.
  if (weightKg != null && (weightKg < 25 || weightKg > 300)) weightKg = null

  const trend = trendKgPerWeek(wSeries)
  const weighIns = wSeries.length
  const spanDays = wSeries.length >= 2
    ? Math.round((new Date(wSeries[wSeries.length - 1].date + 'T00:00:00').getTime() - new Date(wSeries[0].date + 'T00:00:00').getTime()) / 86_400_000)
    : 0
  const weighInsOk = weighIns >= MIN_WEIGH_INS && spanDays >= MIN_SPAN_DAYS

  const proteinByGoal = {
    maintain: weightKg ? round5(weightKg * PROTEIN_PER_KG.maintain) : 0,
    cut:      weightKg ? round5(weightKg * PROTEIN_PER_KG.cut)      : 0,
    gain:     weightKg ? round5(weightKg * PROTEIN_PER_KG.gain)     : 0,
  }

  const loggedDays7 = loggedDates.length
  const consistent = loggedDays7 >= CONSISTENCY_MIN_DAYS

  const calorieFloor = weightKg ? Math.max(CAL_FLOOR_ABS, Math.round(weightKg * CAL_FLOOR_PER_KG)) : CAL_FLOOR_ABS

  const cooldownDaysLeft = Math.max(0, COOLDOWN_DAYS - daysSince(targets.lastCalorieAdjust))
  const inCooldown = cooldownDaysLeft > 0

  // Lead with the tangible kg/week; keep %/wk as the coach-secondary (panel UX).
  const rateText = (t: number, pct: number) => `${t >= 0 ? '+' : ''}${t.toFixed(2)} kg/wk (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%/wk)`

  let calorieAdvice: CalorieAdvice | null = null
  let onTrack: string | null = null
  let atFloor = false

  // Every gate must pass: trustworthy intake AND weight signal AND not cooling down.
  if (consistent && weighInsOk && !inCooldown && weightKg && trend != null) {
    const pct = (trend / weightKg) * 100
    let delta = 0, reason = ''
    if (goal === 'cut') {
      if (pct > -0.2)      { delta = -200; reason = `barely losing — ${rateText(trend, pct)}; a cut should drop ~0.5–1%/wk` }
      else if (pct < -1.0) { delta = +150; reason = `dropping fast — ${rateText(trend, pct)}; protect muscle` }
      else                  onTrack = `On track — ${rateText(trend, pct)}, right where a cut should be`
    } else if (goal === 'gain') {
      if (pct < 0.1)       { delta = +200; reason = `not gaining — ${rateText(trend, pct)}; a lean bulk wants ~0.25–0.5%/wk` }
      else if (pct > 0.5)  { delta = -150; reason = `gaining fast — ${rateText(trend, pct)}; likely extra fat` }
      else                  onTrack = `On track — ${rateText(trend, pct)}, a clean lean-gain pace`
    } else {
      if (pct > 0.3)       { delta = -150; reason = `drifting up — ${rateText(trend, pct)}; likely creeping fat gain` }
      else if (pct < -0.3) { delta = +150; reason = `drifting down — ${rateText(trend, pct)}` }
      else                  onTrack = `Holding steady — ${rateText(trend, pct)}`
    }
    // Never recommend below the floor; surface an honest "take a diet break".
    if (delta < 0 && targets.calories + delta < calorieFloor) { atFloor = true; delta = 0 }
    if (delta !== 0) calorieAdvice = { delta, reason }
  }

  return {
    weightKg,
    proteinByGoal,
    proteinForGoal:  weightKg ? proteinByGoal[goal] : null,
    proteinPerMealG: weightKg ? round5(weightKg * PROTEIN_PER_MEAL_PER_KG) : null,
    fatFloorG:       weightKg && goal === 'cut' ? Math.round(weightKg * FAT_FLOOR_PER_KG) : null,
    calorieFloor,
    trendKgPerWeek:  trend,
    loggedDays7,
    consistent,
    weighIns,
    weighInsOk,
    inCooldown,
    cooldownDaysLeft,
    calorieAdvice,
    onTrack,
    atFloor,
  }
}
