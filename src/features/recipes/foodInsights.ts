// Food → Insights: what your diary says over a window — where calories and
// protein come from, how the day splits across meals, how steadily you log.
// Pure and type-only (scripts/verify-food-insights.cjs). Eaten rows only.
import type { MealSlot } from './types'

export interface InsightRow {
  date: string
  meal_slot: MealSlot
  title: string
  library_ingredient_id: string | null
  recipe_id: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugar_g?: number | null
}

export interface FoodSource {
  key: string
  title: string
  kind: 'recipe' | 'food' | 'custom'
  id: string | null
  count: number
  kcal: number
  protein: number
  /** Share of the window's calories (or protein, for the protein list), 0–100. */
  share: number
}

export interface SlotShare { slot: MealSlot; kcalPerDay: number; proteinPerDay: number; kcalShare: number; daysWith: number }

export interface FoodInsights {
  days: number
  daysLogged: number
  /** Per logged day. */
  avg: { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number }
  /** Share of calories from protein / carbs / fat (4/4/9), 0–100. */
  split: { protein: number; carbs: number; fat: number }
  topKcal: FoodSource[]
  topProtein: FoodSource[]
  mostLogged: FoodSource[]
  slots: SlotShare[]
  /** Logged days in a row, ending today (or yesterday while today is still empty). */
  streak: number
  /** Distinct foods / recipes eaten. */
  variety: number
}

const SLOT_ORDER: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'supplement']
const r1 = (n: number) => Math.round(n * 10) / 10
const shift = (day: string, n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); const p = (x: number) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }

function sourceKey(r: InsightRow): { key: string; kind: FoodSource['kind']; id: string | null } {
  if (r.recipe_id) return { key: `r:${r.recipe_id}`, kind: 'recipe', id: r.recipe_id }
  if (r.library_ingredient_id) return { key: `i:${r.library_ingredient_id}`, kind: 'food', id: r.library_ingredient_id }
  return { key: `c:${r.title.trim().toLowerCase()}`, kind: 'custom', id: null }
}

/** `rows` = eaten rows from `from` to `today` inclusive (`days` long). */
export function buildFoodInsights(rows: readonly InsightRow[], days: number, today: string, top = 8): FoodInsights {
  const dates = new Set(rows.map(r => r.date))
  const daysLogged = dates.size
  const sum = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }
  const sources = new Map<string, Omit<FoodSource, 'share'>>()
  const slots = new Map<MealSlot, { kcal: number; protein: number; days: Set<string> }>()
  for (const r of rows) {
    sum.kcal += r.calories ?? 0; sum.protein += r.protein_g ?? 0; sum.carbs += r.carbs_g ?? 0; sum.fat += r.fat_g ?? 0; sum.fiber += r.fiber_g ?? 0; sum.sugar += r.sugar_g ?? 0
    const { key, kind, id } = sourceKey(r)
    const s = sources.get(key) ?? { key, title: r.title, kind, id, count: 0, kcal: 0, protein: 0 }
    s.count++; s.kcal += r.calories ?? 0; s.protein += r.protein_g ?? 0
    sources.set(key, s)
    const sl = slots.get(r.meal_slot) ?? { kcal: 0, protein: 0, days: new Set<string>() }
    sl.kcal += r.calories ?? 0; sl.protein += r.protein_g ?? 0; sl.days.add(r.date)
    slots.set(r.meal_slot, sl)
  }
  const per = (n: number) => (daysLogged ? r1(n / daysLogged) : 0)
  const all = [...sources.values()]
  const ranked = (val: (s: Omit<FoodSource, 'share'>) => number, total: number) => all
    .filter(s => val(s) > 0)
    .sort((a, b) => val(b) - val(a) || a.title.localeCompare(b.title))
    .slice(0, top)
    .map(s => ({ ...s, kcal: Math.round(s.kcal), protein: r1(s.protein), share: total > 0 ? Math.round((val(s) / total) * 100) : 0 }))
  const macroKcal = 4 * sum.protein + 4 * sum.carbs + 9 * sum.fat
  const pct = (n: number) => (macroKcal > 0 ? Math.round((n / macroKcal) * 100) : 0)

  let streak = 0
  let day = dates.has(today) ? today : shift(today, -1)
  while (dates.has(day)) { streak++; day = shift(day, -1) }

  return {
    days,
    daysLogged,
    avg: { kcal: Math.round(per(sum.kcal)), protein: per(sum.protein), carbs: per(sum.carbs), fat: per(sum.fat), fiber: per(sum.fiber), sugar: per(sum.sugar) },
    split: { protein: pct(4 * sum.protein), carbs: pct(4 * sum.carbs), fat: pct(9 * sum.fat) },
    topKcal: ranked(s => s.kcal, sum.kcal),
    topProtein: ranked(s => s.protein, sum.protein),
    mostLogged: [...all].sort((a, b) => b.count - a.count || b.kcal - a.kcal || a.title.localeCompare(b.title)).slice(0, top)
      .map(s => ({ ...s, kcal: Math.round(s.kcal), protein: r1(s.protein), share: rows.length ? Math.round((s.count / rows.length) * 100) : 0 })),
    slots: SLOT_ORDER.filter(s => slots.has(s)).map(s => {
      const v = slots.get(s)!
      return { slot: s, kcalPerDay: Math.round(per(v.kcal)), proteinPerDay: per(v.protein), kcalShare: sum.kcal > 0 ? Math.round((v.kcal / sum.kcal) * 100) : 0, daysWith: v.days.size }
    }),
    streak,
    variety: sources.size,
  }
}
