import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { FoodLogEntry, FoodLogEntryInput, IngredientLibraryItem, Recipe } from '../types'

// The food DIARY (food_log_entries, migration 053) — what was actually eaten.
// Distinct from recipe_meal_plans (the plan). Macros are snapshotted here at
// log time so later library edits never rewrite history.

export async function fetchFoodLog(date: string): Promise<FoodLogEntry[]> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select('*')
    .eq('date', date)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function addFoodLogEntries(entries: FoodLogEntryInput[]): Promise<void> {
  if (entries.length === 0) return
  const user = await requireUser()
  const { error } = await supabase
    .from('food_log_entries')
    .insert(entries.map(e => ({ ...e, user_id: user.id })))
  if (error) throw error
}

export async function deleteFoodLogEntry(id: string): Promise<void> {
  const { error } = await supabase.from('food_log_entries').delete().eq('id', id)
  if (error) throw error
}

// Snapshot builders — per-100g × grams for ingredients, per-serving ×
// servings for recipes. Grams path only for weight/volume amounts.
const per = (v: number | null | undefined, grams: number) => (v == null ? null : Math.round(v * grams) / 100)

export function ingredientSnapshot(ing: IngredientLibraryItem, grams: number) {
  return {
    calories:  per(ing.calories, grams),
    protein_g: per(ing.protein_g, grams),
    carbs_g:   per(ing.carbs_g, grams),
    fat_g:     per(ing.fat_g, grams),
    fiber_g:   per(ing.fiber_g, grams),
    sugar_g:   per(ing.sugar_g, grams),
  }
}

export function recipeSnapshot(recipe: Recipe, servings: number) {
  const times = (v: number | null) => (v == null ? null : Math.round(v * servings * 10) / 10)
  return {
    calories:  times(recipe.calories),
    protein_g: times(recipe.protein_g),
    carbs_g:   times(recipe.carbs_g),
    fat_g:     times(recipe.fat_g),
    fiber_g:   null,
    sugar_g:   times(recipe.sugar_g),
  }
}
