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

// Edit an existing diary row — a fresh snapshot at edit time (the diary
// contract: editing THIS row re-snapshots it; other rows/history untouched).
// Callers pass a partial patch of the columns they changed.
export async function updateFoodLogEntry(
  id: string,
  patch: Partial<Pick<FoodLogEntry, 'meal_slot' | 'date' | 'custom_title' | 'quantity' | 'unit' | 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g'>>,
): Promise<void> {
  const { error } = await supabase.from('food_log_entries').update(patch).eq('id', id)
  if (error) throw error
}

// A diary row with its display title resolved (library/recipe/custom).
export type LoggedFood = FoodLogEntry & { title: string }

// The DIARY over a date range — feeds the Meal Plan week view so a day you
// actually LOGGED (food_log_entries) shows up next to what you PLANNED
// (recipe_meal_plans), instead of the grid looking empty. Same name-joins as
// fetchFoodLog so titles resolve without a second round-trip.
export async function fetchFoodLogRange(fromDate: string, toDate: string): Promise<LoggedFood[]> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select('*, ingredient:recipe_ingredient_library(name), recipe:recipes(title)')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('created_at', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as unknown as (FoodLogEntry & { ingredient: { name: string } | null; recipe: { title: string } | null })[]
  return rows.map(({ ingredient, recipe, ...row }) => ({
    ...row,
    title: ingredient?.name ?? recipe?.title ?? row.custom_title ?? '—',
  }))
}

// A distinct food the user has eaten before, ready to re-log in one tap with
// its ORIGINAL snapshot macros (the whole point of unifying the log paths — a
// recent chip must carry real macros, not a macro-less title). Sourced from the
// diary (food_log_entries), NOT the plan (recipe_meal_plans).
export interface RecentFood {
  key:                   string
  title:                 string
  library_ingredient_id: string | null
  recipe_id:             string | null
  custom_title:          string | null
  quantity:              number | null
  unit:                  string | null
  calories:              number | null
  protein_g:             number | null
  carbs_g:               number | null
  fat_g:                 number | null
  fiber_g:               number | null
  sugar_g:               number | null
  count:                 number
}

export async function fetchRecentFoods(fromDate: string, slot?: string): Promise<RecentFood[]> {
  let query = supabase
    .from('food_log_entries')
    .select('*, ingredient:recipe_ingredient_library(name), recipe:recipes(title)')
    .gte('date', fromDate)
    .order('created_at', { ascending: false })
  if (slot) query = query.eq('meal_slot', slot)
  const { data, error } = await query
  if (error) throw error
  // Ordered newest-first, so the FIRST row seen per key is the most recent
  // snapshot — that's the one we keep (re-log the way you last ate it).
  const byKey = new Map<string, RecentFood>()
  for (const row of (data ?? []) as unknown as (FoodLogEntry & { ingredient: { name: string } | null; recipe: { title: string } | null })[]) {
    const title = row.ingredient?.name ?? row.recipe?.title ?? row.custom_title ?? '—'
    const key = row.library_ingredient_id ?? row.recipe_id ?? `c:${title.toLowerCase()}`
    const existing = byKey.get(key)
    if (existing) { existing.count++; continue }
    byKey.set(key, {
      key, title,
      library_ingredient_id: row.library_ingredient_id,
      recipe_id:             row.recipe_id,
      custom_title:          row.custom_title,
      quantity:              row.quantity,
      unit:                  row.unit,
      calories:              row.calories,
      protein_g:             row.protein_g,
      carbs_g:               row.carbs_g,
      fat_g:                 row.fat_g,
      fiber_g:               row.fiber_g,
      sugar_g:               row.sugar_g,
      count:                 1,
    })
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, 8)
}

// Distinct dates (yyyy-MM-dd) with ≥1 diary row in [fromDate, toDate] — the
// logging-consistency signal that gates the adaptive-calorie coaching (a
// calorie recommendation off partial intake data would be misleading).
export async function fetchLoggedDates(fromDate: string, toDate: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select('date')
    .gte('date', fromDate)
    .lte('date', toDate)
  if (error) throw error
  return [...new Set((data ?? []).map(r => (r as { date: string }).date))]
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
    fiber_g:   times(recipe.fiber_g),
    sugar_g:   times(recipe.sugar_g),
  }
}
