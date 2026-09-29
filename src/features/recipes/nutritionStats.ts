// Pure nutrition statistics for Food · Today's "Nutrition stats" card, over
// the last 7 or 28 days ending on the viewed date. Import-free so
// scripts/verify-nutrition-stats.cjs can require it. Each stat is one row:
// a tone, a short value, one plain sentence and an evidence tier —
//   measured  = arithmetic on the diary;
//   evidence  = judged against a published range;
//   heuristic = a practitioner rule of thumb.
// Averages are over LOGGED days only (a day with nothing logged is a gap, not
// a 0 kcal day). The intake-vs-burn row reads the goal report's paired days
// (a full diary AND a complete Apple day) — see health/goal/cutDecision.ts
// for the under-logging rule it shares with the coach.

export type StatTone = 'success' | 'warn' | 'danger' | 'info' | 'neutral'
export type StatTier = 'measured' | 'evidence' | 'heuristic'
export type StatKey = 'protein' | 'calories' | 'balance' | 'perMeal' | 'fiber' | 'fat' | 'weekend'

export interface StatRow { key: StatKey; label: string; value: string; tone: StatTone; sentence: string; tier: StatTier }

export interface StatDiaryRow {
  date: string
  meal_slot: string
  calories: number | null
  protein_g: number | null
  fat_g: number | null
  fiber_g: number | null
}

export interface StatBalance {
  /** Paired days in the goal report's 28-day window. */
  days: number
  meanIntake: number | null
  meanBurn: number | null
  /** Logged intake + the scale's own deficit. */
  scaleBurn: number | null
}

export interface StatsInput {
  rows: StatDiaryRow[]
  endDate: string
  period: 7 | 28
  targetKcal: number
  weightKg: number | null
  balance: StatBalance | null
}

export interface NutritionStats { loggedDays: number; period: number; reliable: boolean; rows: StatRow[] }

export const PROTEIN_FLOOR_G_PER_KG = 1.6
export const PER_MEAL_G_PER_KG = 0.4
export const FIBER_LOW = 25
export const FIBER_HIGH = 30
export const FAT_FLOOR_G_PER_KG = 0.6
export const WEEKEND_GAP_KCAL = 500
export const UNDERLOG_SHARE = 0.85
/** A period's averages need ≥ 5 of 7 days (20 of 28) logged. */
export const RELIABLE_SHARE = 5 / 7

function shift(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}
const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

interface Day { date: string; kcal: number; protein: number; fat: number; fiber: number; slotProtein: Map<string, number> }

export function buildNutritionStats(inp: StatsInput): NutritionStats {
  const from = shift(inp.endDate, -(inp.period - 1))
  const byDate = new Map<string, Day>()
  for (const r of inp.rows) {
    if (r.date < from || r.date > inp.endDate) continue
    const d = byDate.get(r.date) ?? { date: r.date, kcal: 0, protein: 0, fat: 0, fiber: 0, slotProtein: new Map() }
    d.kcal += r.calories ?? 0
    d.protein += r.protein_g ?? 0
    d.fat += r.fat_g ?? 0
    d.fiber += r.fiber_g ?? 0
    d.slotProtein.set(r.meal_slot, (d.slotProtein.get(r.meal_slot) ?? 0) + (r.protein_g ?? 0))
    byDate.set(r.date, d)
  }
  const days = [...byDate.values()].filter(d => d.kcal > 0).sort((a, b) => a.date.localeCompare(b.date))
  const logged = days.length
  const need = Math.ceil(inp.period * RELIABLE_SHARE)
  const reliable = logged >= need
  const kg = inp.weightKg
  const rows: StatRow[] = []
  const dayWord = `${logged} of ${inp.period} days`

  if (!logged) return { loggedDays: 0, period: inp.period, reliable: false, rows }

  // Protein — Morton 2018 floor.
  const avgP = mean(days.map(d => d.protein))!
  if (kg) {
    const gkg = avgP / kg
    const hit = days.filter(d => d.protein / kg >= PROTEIN_FLOOR_G_PER_KG).length
    rows.push({
      key: 'protein', label: 'Protein', value: `${n0(avgP)} g · ${gkg.toFixed(1)} g/kg`, tier: 'evidence',
      tone: gkg >= PROTEIN_FLOOR_G_PER_KG ? (hit >= logged * 0.7 ? 'success' : 'neutral') : 'warn',
      sentence: `${hit} of ${logged} logged days reached 1.6 g/kg — the level past which extra protein adds little muscle.`,
    })
  } else {
    rows.push({ key: 'protein', label: 'Protein', value: `${n0(avgP)} g`, tier: 'measured', tone: 'neutral', sentence: 'Add a weigh-in to judge protein per kg of bodyweight.' })
  }

  // Calories vs target, and whether the average can be trusted.
  const avgK = mean(days.map(d => d.kcal))!
  const off = inp.targetKcal > 0 ? (avgK - inp.targetKcal) / inp.targetKcal : 0
  rows.push({
    key: 'calories', label: 'Calories', value: `${n0(avgK)} / ${n0(inp.targetKcal)} kcal`, tier: 'measured',
    tone: !reliable ? 'warn' : Math.abs(off) <= 0.1 ? 'success' : 'neutral',
    sentence: !reliable
      ? `Logged ${dayWord} — averages are reliable from ${need}.`
      : `Logged ${dayWord}; the average is ${Math.abs(off) <= 0.1 ? 'within 10 % of' : `${Math.round(Math.abs(off) * 100)} % ${off > 0 ? 'above' : 'below'}`} your target.`,
  })

  // Logged intake vs what Apple and the scale imply (goal report, 28 days).
  const b = inp.balance
  if (b && b.days > 0 && b.meanIntake != null && b.meanBurn != null) {
    const implied = b.scaleBurn != null ? b.meanBurn - (b.scaleBurn - b.meanIntake) : null
    const under = implied != null && implied > 0 && b.meanIntake < UNDERLOG_SHARE * implied
    rows.push({
      key: 'balance', label: 'Logged vs burned', value: `${n0(b.meanIntake)} vs ${n0(b.meanBurn)} kcal`, tier: 'measured',
      tone: under ? 'warn' : 'neutral',
      sentence: under
        ? `Possible under-logging: Apple's burn and your scale imply you ate ~${n0(implied!)} kcal a day on ${b.days} paired days (last 28) — oils, drinks and weekends are the usual gaps.`
        : `On ${b.days} paired days (last 28) you logged ${n0(b.meanIntake)} kcal and Apple says you burned ${n0(b.meanBurn)}${b.scaleBurn != null ? `; the scale says ~${n0(b.scaleBurn)}` : ''}.`,
    })
  }

  // Protein per meal — soft; ~0.4 g/kg per meal, 3–4 meals (heuristic).
  if (kg) {
    const perMeal = PER_MEAL_G_PER_KG * kg
    const avgMeals = mean(days.map(d => [...d.slotProtein.values()].filter(g => g >= perMeal).length))!
    rows.push({
      key: 'perMeal', label: 'Protein per meal', value: `${avgMeals.toFixed(1)} meals/day`, tier: 'heuristic',
      tone: avgMeals >= 3 ? 'success' : avgMeals >= 2 ? 'neutral' : 'info',
      sentence: `Meals with ≥ ${Math.round(perMeal)} g protein (0.4 g/kg) per logged day — 3–4 spreads it best, but the daily total matters most.`,
    })
  }

  // Fibre vs 25–30 g.
  const avgF = mean(days.map(d => d.fiber))!
  rows.push({
    key: 'fiber', label: 'Fibre', value: `${n0(avgF)} g/day`, tier: 'evidence',
    tone: avgF >= FIBER_LOW ? 'success' : avgF >= 20 ? 'neutral' : 'warn',
    sentence: avgF >= FIBER_LOW ? 'At or above the 25–30 g a day most guidelines advise.' : `Below the 25–30 g a day most guidelines advise — about ${n0(FIBER_LOW - avgF)} g short.`,
  })

  // Fat vs the 0.6 g/kg floor (heuristic).
  const avgFat = mean(days.map(d => d.fat))!
  if (kg) {
    const floor = FAT_FLOOR_G_PER_KG * kg
    rows.push({
      key: 'fat', label: 'Fat', value: `${n0(avgFat)} g · ${(avgFat / kg).toFixed(1)} g/kg`, tier: 'heuristic',
      tone: avgFat >= floor ? 'success' : 'warn',
      sentence: avgFat >= floor ? `Above the ~${n0(floor)} g (0.6 g/kg) floor for hormonal health.` : `Below the ~${n0(floor)} g (0.6 g/kg) floor for hormonal health.`,
    })
  }

  // Weekday vs weekend.
  const weekend = days.filter(d => { const w = weekday(d.date); return w === 0 || w === 6 })
  const weekdays = days.filter(d => { const w = weekday(d.date); return w !== 0 && w !== 6 })
  if (weekend.length && weekdays.length >= 2) {
    const gap = mean(weekend.map(d => d.kcal))! - mean(weekdays.map(d => d.kcal))!
    const big = Math.abs(gap) > WEEKEND_GAP_KCAL
    rows.push({
      key: 'weekend', label: 'Weekend vs weekdays', value: `${gap >= 0 ? '+' : '−'}${n0(Math.abs(gap))} kcal`, tier: 'measured',
      tone: big ? 'warn' : 'success',
      sentence: big
        ? `Weekend days average ${n0(Math.abs(gap))} kcal ${gap > 0 ? 'more' : 'less'} than weekdays — enough to change the week's balance.`
        : 'Weekends and weekdays are within 500 kcal of each other.',
    })
  }

  return { loggedDays: logged, period: inp.period, reliable, rows }
}
