import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { FoodLogEntry, FoodLogEntryInput, IngredientLibraryItem, MealSlot, Recipe } from '../types'
import { WEIGHT_UNITS } from './recipesApi'

// The food DIARY (food_log_entries, migration 053) — what was actually eaten.
// Distinct from recipe_meal_plans (the plan). Macros are snapshotted here at
// log time so later library edits never rewrite history.

// food_log_entries.status (migration 061) discriminates 'planned' vs 'eaten' —
// the plan and the diary now share this one table. Until 061 is applied the
// column is absent (a filter on it 42703s); pre-061 EVERY row here is eaten
// (planned lived in recipe_meal_plans), so we simply retry without the filter.
function isMissingStatus(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /status/i.test(x?.message ?? '')
}

// migration 087 (meal_group_id) may not be applied yet — same pre-migration-
// safe convention. Retrying without it just means "As meal" degrades to
// separate rows (today's behaviour), never a hard failure.
function isMissingMealGroup(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /meal_group_id/i.test(x?.message ?? '')
}

export async function fetchFoodLog(date: string): Promise<FoodLogEntry[]> {
  const q = () => supabase.from('food_log_entries').select('*').eq('date', date).order('created_at', { ascending: true })
  let { data, error } = await q().eq('status', 'eaten')
  if (error && isMissingStatus(error)) ({ data, error } = await q())
  if (error) throw error
  return data ?? []
}

export async function addFoodLogEntries(entries: FoodLogEntryInput[]): Promise<void> {
  if (entries.length === 0) return
  const user = await requireUser()
  const base = entries.map(e => ({ ...e, user_id: user.id }))
  let { error } = await supabase.from('food_log_entries').insert(base.map(r => ({ ...r, status: 'eaten' })))
  if (error && isMissingMealGroup(error)) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const stripped = base.map(({ meal_group_id, ...rest }) => rest)
    error = (await supabase.from('food_log_entries').insert(stripped.map(r => ({ ...r, status: 'eaten' })))).error
  }
  if (error && isMissingStatus(error)) {
    error = (await supabase.from('food_log_entries').insert(base)).error   // pre-061: no status column
  }
  if (error) throw error
}

export async function deleteFoodLogEntry(id: string): Promise<void> {
  const { error } = await supabase.from('food_log_entries').delete().eq('id', id)
  if (error) throw error
}

/** Deletes rows and returns them exactly as they were — what "Undo" re-inserts. */
export async function deleteFoodLogEntriesReturning(ids: string[]): Promise<FoodLogEntry[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase.from('food_log_entries').delete().in('id', ids).select('*')
  if (error) throw error
  return (data ?? []) as FoodLogEntry[]
}

/** Puts deleted rows back unchanged (same id, date, slot, group, created_at). */
export async function restoreFoodLogEntries(rows: FoodLogEntry[]): Promise<void> {
  if (rows.length === 0) return
  const { error } = await supabase.from('food_log_entries').insert(rows)
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
  const q = () => supabase
    .from('food_log_entries')
    .select('*, ingredient:recipe_ingredient_library(name), recipe:recipes(title)')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('created_at', { ascending: true })
  let { data, error } = await q().eq('status', 'eaten')
  if (error && isMissingStatus(error)) ({ data, error } = await q())
  if (error) throw error
  const rows = (data ?? []) as unknown as (FoodLogEntry & { ingredient: { name: string } | null; recipe: { title: string } | null })[]
  return rows.map(({ ingredient, recipe, ...row }) => ({
    ...row,
    title: ingredient?.name ?? recipe?.title ?? row.custom_title ?? '—',
  }))
}

// One diary row by id with its display title resolved — what the edit popup
// loads, so it never saves back a stale row a list handed over.
export async function fetchFoodLogEntry(id: string): Promise<LoggedFood | null> {
  const { data, error } = await supabase
    .from('food_log_entries')
    .select('*, ingredient:recipe_ingredient_library(name), recipe:recipes(title)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const { ingredient, recipe, ...row } = data as unknown as FoodLogEntry & { ingredient: { name: string } | null; recipe: { title: string } | null }
  return { ...row, title: ingredient?.name ?? recipe?.title ?? row.custom_title ?? '—' }
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
  /** How often it was logged per meal slot (recents only) — for slot-aware suggestions. */
  slotCounts?:           Partial<Record<string, number>>
}

/** A recent/favourite food as a new diary row for `date`/`slot`, the way it was last eaten. */
export function recentToEntry(r: RecentFood, date: string, slot: MealSlot): FoodLogEntryInput {
  return {
    date, meal_slot: slot,
    library_ingredient_id: r.library_ingredient_id, recipe_id: r.recipe_id, custom_title: r.custom_title,
    quantity: r.quantity, unit: r.unit,
    calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g, sugar_g: r.sugar_g,
  }
}

export async function fetchRecentFoods(fromDate: string, slot?: string): Promise<RecentFood[]> {
  // Recents = what was actually EATEN (status='eaten'), never planned rows.
  const build = (withStatus: boolean) => {
    let q = supabase
      .from('food_log_entries')
      .select('*, ingredient:recipe_ingredient_library(name), recipe:recipes(title)')
      .gte('date', fromDate)
      .order('created_at', { ascending: false })
    if (slot) q = q.eq('meal_slot', slot)
    if (withStatus) q = q.eq('status', 'eaten')
    return q
  }
  let { data, error } = await build(true)
  if (error && isMissingStatus(error)) ({ data, error } = await build(false))
  if (error) throw error
  const hidden = await fetchHiddenRecentKeys()
  // Ordered newest-first, so the FIRST row seen per key is the most recent
  // snapshot — that's the one we keep (re-log the way you last ate it).
  const byKey = new Map<string, RecentFood>()
  for (const row of (data ?? []) as unknown as (FoodLogEntry & { ingredient: { name: string } | null; recipe: { title: string } | null })[]) {
    const title = row.ingredient?.name ?? row.recipe?.title ?? row.custom_title ?? '—'
    const key = row.library_ingredient_id ?? row.recipe_id ?? `c:${title.toLowerCase()}`
    if (hidden.has(key)) continue
    const existing = byKey.get(key)
    if (existing) {
      existing.count++
      existing.slotCounts![row.meal_slot] = (existing.slotCounts![row.meal_slot] ?? 0) + 1
      continue
    }
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
      slotCounts:            { [row.meal_slot]: 1 },
    })
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, 16)
}

// food_favorites / food_recent_hidden (migration 087) may not be applied yet —
// same pre-migration-safe convention as the rest of this file: a missing-
// table READ degrades to empty (Recents/Favorites just don't have the new
// behaviour yet), a missing-table WRITE throws a named error.
function isMissingTable(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return x?.code === '42P01' || x?.code === 'PGRST205' || /Could not find the table/i.test(x?.message ?? '')
}

const NOT_MIGRATED_087 =
  'Favourites / hidden-recents are not available yet — migration 087 (food_favorites / food_recent_hidden) has not been applied.'

export async function fetchHiddenRecentKeys(): Promise<Set<string>> {
  const { data, error } = await supabase.from('food_recent_hidden').select('food_key')
  if (error) {
    if (isMissingTable(error)) return new Set()
    throw error
  }
  return new Set((data ?? []).map(r => r.food_key as string))
}

export async function hideRecentFood(foodKey: string): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase
    .from('food_recent_hidden')
    .upsert({ user_id: user.id, food_key: foodKey }, { onConflict: 'user_id,food_key' })
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_087) : error
}

export async function fetchFoodFavorites(): Promise<RecentFood[]> {
  const { data, error } = await supabase
    .from('food_favorites')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) {
    if (isMissingTable(error)) return []
    throw error
  }
  return (data ?? []).map(r => ({
    key: r.food_key, title: r.title,
    library_ingredient_id: r.library_ingredient_id, recipe_id: r.recipe_id, custom_title: r.custom_title,
    quantity: r.quantity, unit: r.unit,
    calories: r.calories, protein_g: r.protein_g, carbs_g: r.carbs_g, fat_g: r.fat_g, fiber_g: r.fiber_g, sugar_g: r.sugar_g,
    count: 0,
  }))
}

export async function addFoodFavorite(food: RecentFood): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('food_favorites').upsert({
    user_id: user.id, food_key: food.key, title: food.title,
    library_ingredient_id: food.library_ingredient_id, recipe_id: food.recipe_id, custom_title: food.custom_title,
    quantity: food.quantity, unit: food.unit,
    calories: food.calories, protein_g: food.protein_g, carbs_g: food.carbs_g, fat_g: food.fat_g, fiber_g: food.fiber_g, sugar_g: food.sugar_g,
  }, { onConflict: 'user_id,food_key' })
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_087) : error
}

export async function removeFoodFavorite(foodKey: string): Promise<void> {
  const { error } = await supabase.from('food_favorites').delete().eq('food_key', foodKey)
  if (error) throw isMissingTable(error) ? new Error(NOT_MIGRATED_087) : error
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

const MACROS = ['calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'sugar_g'] as const

/**
 * Recalculates eaten diary rows from their source after the source changed —
 * a library item's per-100g values, or a recipe's per-serving totals — so past
 * days always show what their ingredients add up to (user decision 2026-09-26:
 * totals are derived, never frozen). Custom rows and planned rows are left
 * alone. Migration 106's triggers do the same inside the database for every
 * writer; this is the web app's copy for before it is applied.
 */
export async function refreshEatenEntries({ libraryId, recipeIds = [] }: { libraryId?: string; recipeIds?: string[] }): Promise<void> {
  const filters: string[] = []
  if (libraryId) filters.push(`library_ingredient_id.eq.${libraryId}`)
  if (recipeIds.length) filters.push(`recipe_id.in.(${recipeIds.join(',')})`)
  if (!filters.length) return

  const { data: rows, error } = await supabase
    .from('food_log_entries')
    .select('id, quantity, unit, library_ingredient_id, recipe_id, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g')
    .eq('status', 'eaten')
    .or(filters.join(','))
  if (error) throw error
  if (!rows?.length) return

  const libIds = [...new Set(rows.map(r => r.library_ingredient_id).filter((x): x is string => !!x))]
  const recIds = [...new Set(rows.map(r => r.recipe_id).filter((x): x is string => !!x))]
  const [libRes, recRes] = await Promise.all([
    libIds.length ? supabase.from('recipe_ingredient_library').select('*').in('id', libIds) : Promise.resolve({ data: [], error: null }),
    recIds.length ? supabase.from('recipes').select('*').in('id', recIds) : Promise.resolve({ data: [], error: null }),
  ])
  if (libRes.error) throw libRes.error
  if (recRes.error) throw recRes.error
  const libs = new Map((libRes.data ?? []).map(l => [l.id, l as IngredientLibraryItem]))
  const recs = new Map((recRes.data ?? []).map(r => [r.id, r as Recipe]))

  for (const row of rows) {
    if (row.quantity == null) continue
    let next: Record<(typeof MACROS)[number], number | null> | null = null
    if (row.recipe_id) {
      const recipe = recs.get(row.recipe_id)
      if (recipe && recipe.calories != null) next = recipeSnapshot(recipe, row.quantity)
    } else if (row.library_ingredient_id && WEIGHT_UNITS.has((row.unit ?? 'g').trim().toLowerCase())) {
      const lib = libs.get(row.library_ingredient_id)
      if (lib) next = ingredientSnapshot(lib, row.quantity)
    }
    if (!next || MACROS.every(m => (row[m] ?? null) === next![m])) continue
    const { error: upError } = await supabase.from('food_log_entries').update(next).eq('id', row.id)
    if (upError) throw upError
  }
}
