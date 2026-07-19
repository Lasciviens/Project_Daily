import { useQuery } from '@tanstack/react-query'
import { useHealthMetricSeries } from '../../training/hooks/useHealthExport'
import { computeDailySeries } from '../../training/healthAggregate'
import { fetchLoggedDates } from '../../recipes/api/foodLogApi'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import type { NutritionGoal } from './useDayTargets'

// ─────────────────────────────────────────────────────────────────────────────
//  Nutrition coaching signals — bodyweight-driven protein targets + an
//  adaptive-calorie nudge from the real weight trend. Grounded in the
//  dietitian's contract: protein 1.6–2.4 g/kg (higher on a cut to spare lean
//  mass); a calorie recommendation is only offered when there's enough recent
//  logging to make it meaningful (otherwise it's guessing off partial intake).
// ─────────────────────────────────────────────────────────────────────────────

// Protein grams per kg bodyweight by goal (all inside the evidence range).
const PROTEIN_PER_KG: Record<NutritionGoal, number> = { maintain: 1.8, cut: 2.2, gain: 1.8 }

const WEIGHT_WINDOW_DAYS = 28
const CONSISTENCY_WINDOW_DAYS = 7
const CONSISTENCY_MIN_DAYS = 4          // ≥4 of last 7 logged → calorie advice unlocked

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

export interface CalorieAdvice { delta: number; reason: string }

export interface NutritionCoach {
  weightKg:       number | null
  proteinByGoal:  Record<NutritionGoal, number>
  proteinForGoal: number | null
  trendKgPerWeek: number | null
  loggedDays7:    number
  consistent:     boolean
  calorieAdvice:  CalorieAdvice | null
}

// `goal` is passed in (NOT read via useDayTargets) so it always reflects the
// single source of truth in NutritionCard — useDayTargets is per-instance
// local state, so a second instance here would go stale on goal changes.
export function useNutritionCoach(date: string, goal: NutritionGoal): NutritionCoach {
  const from = shiftDateStr(date, -WEIGHT_WINDOW_DAYS)
  const { data: wPts = [] } = useHealthMetricSeries('weight_body_mass', from, date)
  const { data: loggedDates = [] } = useQuery({
    queryKey: ['food-log', 'logged-dates', date],
    queryFn:  () => fetchLoggedDates(shiftDateStr(date, -(CONSISTENCY_WINDOW_DAYS - 1)), date),
    staleTime: 5 * 60_000,
  })

  const wSeries = computeDailySeries('weight_body_mass', wPts)
  const weightKg = wSeries.length ? wSeries[wSeries.length - 1].value : null
  const trend = trendKgPerWeek(wSeries)

  const proteinByGoal = {
    maintain: weightKg ? round5(weightKg * PROTEIN_PER_KG.maintain) : 0,
    cut:      weightKg ? round5(weightKg * PROTEIN_PER_KG.cut)      : 0,
    gain:     weightKg ? round5(weightKg * PROTEIN_PER_KG.gain)     : 0,
  }

  const loggedDays7 = loggedDates.length
  const consistent = loggedDays7 >= CONSISTENCY_MIN_DAYS

  // Adaptive calorie nudge — only when consistent AND we have a real trend.
  // Targets expressed as %/week of bodyweight; nudge ±kcal toward the target.
  let calorieAdvice: CalorieAdvice | null = null
  if (consistent && weightKg && trend != null) {
    const pctPerWeek = (trend / weightKg) * 100
    if (goal === 'cut') {
      if (pctPerWeek > -0.2)      calorieAdvice = { delta: -200, reason: `weight is ${pctPerWeek >= 0 ? 'up' : 'flat'} (${pctPerWeek.toFixed(1)}%/wk) on a cut` }
      else if (pctPerWeek < -1.0) calorieAdvice = { delta: +150, reason: `dropping fast (${pctPerWeek.toFixed(1)}%/wk) — protect muscle` }
    } else if (goal === 'gain') {
      if (pctPerWeek < 0.1)       calorieAdvice = { delta: +200, reason: `weight is ${pctPerWeek <= 0 ? 'flat/down' : 'barely up'} (${pctPerWeek.toFixed(1)}%/wk) on a bulk` }
      else if (pctPerWeek > 0.5)  calorieAdvice = { delta: -150, reason: `gaining fast (${pctPerWeek.toFixed(1)}%/wk) — likely extra fat` }
    } else {
      if (pctPerWeek > 0.3)       calorieAdvice = { delta: -150, reason: `drifting up (${pctPerWeek.toFixed(1)}%/wk)` }
      else if (pctPerWeek < -0.3) calorieAdvice = { delta: +150, reason: `drifting down (${pctPerWeek.toFixed(1)}%/wk)` }
    }
  }

  return {
    weightKg,
    proteinByGoal,
    proteinForGoal: weightKg ? proteinByGoal[goal] : null,
    trendKgPerWeek: trend,
    loggedDays7,
    consistent,
    calorieAdvice,
  }
}
