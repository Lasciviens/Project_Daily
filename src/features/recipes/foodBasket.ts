// The basket shared by the food logger (FoodLogModal) and the Library's quick
// recipe builder (RecipeBuilder): foods by weight, their live totals, and the
// recipe ingredient rows a basket saves as. Pure (scripts/verify-food-library.cjs).
import { gramsPerUnit } from './foodUnits'
import type { IngredientDraft, IngredientLibraryItem } from './types'

export interface BasketItem { ingredient: IngredientLibraryItem; grams: number }

/** A basket amount is grams, or ml for a drink stored per 100 ml. */
export const amountUnit = (u: string | null | undefined): 'g' | 'ml' => (u?.trim().toLowerCase() === 'ml' ? 'ml' : 'g')

export interface MacroSum { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number }

const ZERO: MacroSum = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }

/** Per-100 g macros × grams, summed over the basket (unrounded). */
export function basketTotals(items: readonly BasketItem[]): MacroSum {
  return items.reduce((t, { ingredient: f, grams }) => {
    const k = grams > 0 ? grams / 100 : 0
    return {
      kcal: t.kcal + (f.calories ?? 0) * k, protein: t.protein + (f.protein_g ?? 0) * k,
      carbs: t.carbs + (f.carbs_g ?? 0) * k, fat: t.fat + (f.fat_g ?? 0) * k,
      fiber: t.fiber + (f.fiber_g ?? 0) * k, sugar: t.sugar + (f.sugar_g ?? 0) * k,
    }
  }, ZERO)
}

/** recipes.servings is a whole number (an integer column — "2.5" failed to save). */
export const wholePortions = (raw: string | number): number => Math.max(1, Math.round(Number(raw) || 1))

/** One portion of a batch, rounded to 0.1 like the saved per-serving macros. */
export function perPortion(t: MacroSum, portions: number): MacroSum {
  const n = Math.max(1, portions)
  const r = (v: number) => Math.round((v / n) * 10) / 10
  return { kcal: r(t.kcal), protein: r(t.protein), carbs: r(t.carbs), fat: r(t.fat), fiber: r(t.fiber), sugar: r(t.sugar) }
}

/** The recipe ingredient rows a basket saves as: every row library-linked by weight, so the macros follow the foods. */
export function basketToIngredients(items: readonly BasketItem[]): IngredientDraft[] {
  return items.map(it => ({
    name: it.ingredient.name, quantity: it.grams, unit: amountUnit(it.ingredient.unit), note: null, library_ingredient_id: it.ingredient.id,
  }))
}

/** Whole portions of the food's preset in this amount (for − / +), or null when it has no preset. */
export function portionSteps(item: BasketItem): { size: number; count: number; label: string } | null {
  const size = item.ingredient.serving_grams
  const label = item.ingredient.serving_label
  if (!label || size == null || size <= 0) return null
  return { size, count: Math.max(1, Math.round(item.grams / size)), label: label.replace(/^1\s*/, '') }
}

/** The amount a recent food was last eaten in, as basket grams — none for a count ("2 pcs"). */
export function lastGrams(r: { quantity: number | null; unit: string | null }): number | undefined {
  return r.quantity != null && r.quantity > 0 && gramsPerUnit(r.unit ?? 'g') === 1 ? r.quantity : undefined
}
