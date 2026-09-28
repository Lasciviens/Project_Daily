// The one-line "Your goal" summary shown on Food, Daily and Health, so the
// same numbers read as ONE goal everywhere. Pure and import-free
// (scripts/verify-body-goal.cjs).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PHASE: Record<string, string> = { cut: 'Cut', maintain: 'Maintain', gain: 'Gain' }

export interface GoalSummaryInput {
  goal: string
  phaseStartDate: string | null
  calories: number
  protein: number
  goalWeightKg: number | null
  goalBodyFatPct: number | null
  goalMuscleMassKg: number | null
}

/** "1 Sep", "1 Sep 2025" in another year (en-GB, day first). */
export function sinceLabel(date: string, today: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number)
  return `${d} ${MONTHS[m - 1]}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`
}

const n0 = (v: number) => Math.round(v).toLocaleString('en-GB')
const n1 = (v: number) => (Math.round(v * 10) / 10).toString()

/** ["Cut since 1 Sep", "1,950 kcal", "180 g protein", "→ 78 kg · 14 % body fat"]. */
export function goalSummaryParts(t: GoalSummaryInput, today: string): string[] {
  const phase = PHASE[t.goal] ?? t.goal
  const body = [
    t.goalWeightKg != null ? `${n1(t.goalWeightKg)} kg` : null,
    t.goalBodyFatPct != null ? `${n1(t.goalBodyFatPct)} % body fat` : null,
    t.goalMuscleMassKg != null ? `${n1(t.goalMuscleMassKg)} kg muscle` : null,
  ].filter((x): x is string => x != null)
  return [
    t.phaseStartDate ? `${phase} since ${sinceLabel(t.phaseStartDate, today)}` : phase,
    `${n0(t.calories)} kcal`,
    `${n0(t.protein)} g protein`,
    ...(body.length ? [`→ ${body.join(' · ')}`] : []),
  ]
}
