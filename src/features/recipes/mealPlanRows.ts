import { toGrams } from './foodUnits'
import type { FoodLogEntryInput, MealSlot } from './types'

// What a PLANNED row is (food_log_entries, status 'planned', migration 061) —
// pure, so scripts/verify-meal-plan.cjs checks it. Planning saves the same
// shapes as logging: a recipe + servings, a library food + amount + unit, or
// a one-off title. A food or recipe stores no totals (they are worked out
// live on read, and stored only when the row is ticked as eaten); a one-off
// line keeps what was typed, as an eaten one does. Planned rows never count
// in the day's ring.

export const MACRO_KEYS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'] as const
export type PlanMacros = Record<typeof MACRO_KEYS[number], number | null>

export interface PlannedRow extends PlanMacros {
  date:                  string
  meal_slot:             MealSlot
  status:                'planned'
  recipe_id:             string | null
  library_ingredient_id: string | null
  custom_title:          string | null
  quantity:              number | null
  unit:                  string | null
}

const NO_MACROS: PlanMacros = { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null }

/** A logger row (`itemsToEntries`, `recentToEntry`, a typed line) as a planned row. Dishes are not planned: no meal group. */
export function plannedRow(e: FoodLogEntryInput): PlannedRow {
  const at = { date: e.date, meal_slot: e.meal_slot, status: 'planned' as const }
  if (e.recipe_id) {
    return { ...at, recipe_id: e.recipe_id, library_ingredient_id: null, custom_title: null, quantity: e.quantity ?? 1, unit: 'serving', ...NO_MACROS }
  }
  if (e.library_ingredient_id) {
    return { ...at, recipe_id: null, library_ingredient_id: e.library_ingredient_id, custom_title: null, quantity: e.quantity ?? null, unit: e.unit ?? 'g', ...NO_MACROS }
  }
  const own = Object.fromEntries(MACRO_KEYS.map(k => [k, e[k] ?? null])) as PlanMacros
  return { ...at, recipe_id: null, library_ingredient_id: null, custom_title: e.custom_title?.trim() || null, quantity: e.quantity ?? null, unit: e.unit ?? null, ...own }
}

/** What a planned row's kcal is worked out from (the plan view-model plus its embeds). */
export interface PlanKcalSource {
  recipe_id:             string | null
  servings:              number
  recipe?:               { calories: number | null } | null
  library_ingredient_id: string | null
  ingredient_quantity:   number | null
  ingredient_unit:       string | null
  ingredient?:           { calories?: number | null } | null
  /** A one-off line's own (typed) kcal. */
  calories?:             number | null
}

/**
 * A planned row's kcal, live: a recipe per serving × servings, a food per
 * 100 g × its grams — null when its unit can't be counted ("2 pcs", the same
 * weight-unit gate as every reader) — or a one-off line's typed kcal.
 */
export function plannedKcal(p: PlanKcalSource): number | null {
  if (p.recipe_id) return p.recipe?.calories != null ? p.recipe.calories * (p.servings || 1) : null
  if (p.library_ingredient_id) {
    const grams = toGrams(p.ingredient_quantity, p.ingredient_unit ?? 'g')
    return grams != null && p.ingredient?.calories != null ? (p.ingredient.calories * grams) / 100 : null
  }
  return p.calories ?? null
}
