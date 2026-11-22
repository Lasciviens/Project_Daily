// The recipe editor's "Estimate" (AI last): what code can work out comes first. An ingredient that is linked to the
// owner's library (or whose name is exactly one library food's name) and has an amount in a weight or volume unit is
// COMPUTED from the library's per-100 g values; only the rest is sent to the AI. When nothing is left, no AI is asked.
// Pure; verified by scripts/verify-food-ingredients.cjs.

import { toGrams } from './foodUnits'
import type { IngredientDraft, IngredientLibraryItem } from './types'

export interface PerServing { calories: number; protein_g: number; carbs_g: number; fat_g: number; sugar_g: number }
export interface EstimateValues { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; sugar_g: number | null }

/** A food name as compared: lower case, white space collapsed. (No accent folding: å and a are different letters.) */
export function normalizeFoodName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface MacroPlan {
  /** One serving's values from the ingredients code could work out, or null when none could. */
  computed: PerServing | null
  /** How many ingredients that is. */
  computedCount: number
  /** The ingredients left for the AI. */
  rest: IngredientDraft[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Splits the named ingredients into the ones the library computes and the ones left to estimate. */
export function planMacroEstimate(rows: readonly IngredientDraft[], servings: number, library: readonly IngredientLibraryItem[]): MacroPlan {
  const byId = new Map(library.map(l => [l.id, l]))
  // A name that two library foods share is ambiguous: it is left to the AI, never guessed.
  const byName = new Map<string, IngredientLibraryItem | null>()
  for (const l of library) {
    const key = normalizeFoodName(l.name)
    byName.set(key, byName.has(key) ? null : l)
  }
  const total = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0 }
  let computedCount = 0
  const rest: IngredientDraft[] = []
  for (const row of rows) {
    if (!row.name.trim() && !row.library_ingredient_id) continue
    const food = row.library_ingredient_id ? byId.get(row.library_ingredient_id) : byName.get(normalizeFoodName(row.name))
    const grams = toGrams(row.quantity, row.unit)
    if (!food || food.calories == null || grams == null || !(grams > 0)) { rest.push(row); continue }
    const factor = grams / 100
    total.calories += food.calories * factor
    total.protein_g += (food.protein_g ?? 0) * factor
    total.carbs_g += (food.carbs_g ?? 0) * factor
    total.fat_g += (food.fat_g ?? 0) * factor
    total.sugar_g += (food.sugar_g ?? 0) * factor
    computedCount++
  }
  const per = (v: number) => round1(v / Math.max(1, servings))
  return {
    computed: computedCount
      ? { calories: per(total.calories), protein_g: per(total.protein_g), carbs_g: per(total.carbs_g), fat_g: per(total.fat_g), sugar_g: per(total.sugar_g) }
      : null,
    computedCount,
    rest,
  }
}

/** The computed part and the AI's estimate of the rest, added: one serving's values, and a sentence saying how much was which. */
export function combineEstimate(plan: MacroPlan, ai: EstimateValues | null): { values: EstimateValues; summary: string } {
  const add = (key: keyof PerServing): number | null => {
    const a = plan.computed?.[key] ?? null
    const b = ai?.[key] ?? null
    return a === null && b === null ? null : round1((a ?? 0) + (b ?? 0))
  }
  const values: EstimateValues = { calories: add('calories'), protein_g: add('protein_g'), carbs_g: add('carbs_g'), fat_g: add('fat_g'), sugar_g: add('sugar_g') }
  const noun = (n: number) => `${n} ingredient${n === 1 ? '' : 's'}`
  const summary = !plan.rest.length
    ? `Computed from your library (${noun(plan.computedCount)}) — no AI used`
    : plan.computedCount
      ? `Computed from your library: ${noun(plan.computedCount)} · estimated by AI: ${noun(plan.rest.length)}`
      : `Estimated by AI: ${noun(plan.rest.length)}`
  return { values, summary }
}
