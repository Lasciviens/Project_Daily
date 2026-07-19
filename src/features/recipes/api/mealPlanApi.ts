import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { ingredientSnapshot, recipeSnapshot } from './foodLogApi'
import type { MealPlanEntry, CreateMealPlanEntryInput, Recipe, IngredientLibraryItem } from '../types'

// The PLAN now lives in `food_log_entries` as status='planned' rows (migration
// 061 merged the old `recipe_meal_plans` table in). This module is the adapter
// between that one table and the MealPlanEntry view-model the UI still uses, so
// AssignMealModal / MealPlanWeek didn't have to change. A plan row carries NO
// macro snapshot (computed live on read); its amount lives in quantity/unit
// (recipe → servings·'serving'; library → grams·unit). Pre-061 (the `status`
// column absent) every path falls back to the original recipe_meal_plans table.

function isMissingStatus(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /status/i.test(x?.message ?? '')
}

interface PlanRow {
  id: string; user_id: string; date: string; meal_slot: MealPlanEntry['meal_slot']
  recipe_id: string | null; library_ingredient_id: string | null; custom_title: string | null
  quantity: number | null; unit: string | null; created_at: string
  recipe: MealPlanEntry['recipe']; ingredient: MealPlanEntry['ingredient']
}

// food_log_entries planned row → the plan view-model.
function rowToEntry(r: PlanRow): MealPlanEntry {
  return {
    id: r.id, user_id: r.user_id, date: r.date, meal_slot: r.meal_slot,
    recipe_id: r.recipe_id, custom_title: r.custom_title, library_ingredient_id: r.library_ingredient_id,
    ingredient_quantity: r.library_ingredient_id ? r.quantity : null,
    ingredient_unit:     r.library_ingredient_id ? r.unit : null,
    servings:            r.recipe_id ? (r.quantity ?? 1) : 1,
    notes:               null,
    created_at:          r.created_at,
    recipe:              r.recipe,
    ingredient:          r.ingredient,
  }
}

const PLAN_SELECT = '*, recipe:recipes(id, title, calories), ingredient:recipe_ingredient_library(id, name)'

export async function fetchMealPlan(weekStart: string, weekEnd: string): Promise<MealPlanEntry[]> {
  const q = () => supabase.from('food_log_entries').select(PLAN_SELECT).gte('date', weekStart).lte('date', weekEnd)
  const { data, error } = await q().eq('status', 'planned')
  if (!error) return ((data ?? []) as unknown as PlanRow[]).map(rowToEntry)
  if (!isMissingStatus(error)) throw error
  // pre-061: read the original table (already in the MealPlanEntry shape).
  const legacy = await supabase
    .from('recipe_meal_plans')
    .select('*, recipe:recipes(id, title, calories), ingredient:recipe_ingredient_library(id, name)')
    .gte('date', weekStart).lte('date', weekEnd)
  if (legacy.error) throw legacy.error
  return legacy.data ?? []
}

// Map a plan-input to a food_log_entries 'planned' row: the amount goes into
// quantity/unit; macros stay null (live on read).
function plannedRow(input: CreateMealPlanEntryInput) {
  const isRecipe = !!input.recipe_id
  const isLib = !!input.library_ingredient_id
  return {
    date: input.date, meal_slot: input.meal_slot, status: 'planned' as const,
    recipe_id: input.recipe_id ?? null,
    library_ingredient_id: input.library_ingredient_id ?? null,
    custom_title: input.custom_title ?? null,
    quantity: isRecipe ? (input.servings ?? 1) : isLib ? (input.ingredient_quantity ?? null) : null,
    unit:     isRecipe ? 'serving' : isLib ? (input.ingredient_unit ?? 'g') : null,
  }
}

// Legacy recipe_meal_plans row shape (pre-061 fallback only).
function legacyRow(input: CreateMealPlanEntryInput) {
  return {
    date: input.date, meal_slot: input.meal_slot,
    recipe_id: input.recipe_id ?? null, custom_title: input.custom_title ?? null,
    library_ingredient_id: input.library_ingredient_id ?? null,
    ingredient_quantity: input.ingredient_quantity ?? null, ingredient_unit: input.ingredient_unit ?? null,
    servings: input.servings ?? 1, notes: input.notes ?? null,
  }
}

export async function setMealPlanEntry(input: CreateMealPlanEntryInput): Promise<void> {
  const user = await requireUser()
  const row = plannedRow(input)
  const { error } = input.id
    ? await supabase.from('food_log_entries').update(row).eq('id', input.id)
    : await supabase.from('food_log_entries').insert({ ...row, user_id: user.id })
  if (!error) return
  if (!isMissingStatus(error)) throw error
  // pre-061: write the original table.
  const lrow = legacyRow(input)
  const legacy = input.id
    ? await supabase.from('recipe_meal_plans').update(lrow).eq('id', input.id)
    : await supabase.from('recipe_meal_plans').insert({ ...lrow, user_id: user.id })
  if (legacy.error) throw legacy.error
}

export async function deleteMealPlanEntry(id: string): Promise<void> {
  // Delete by id from the unified table (post-061). Pre-061 the id belongs to
  // recipe_meal_plans instead, so also try there — ignore "table gone" post-061.
  const a = await supabase.from('food_log_entries').delete().eq('id', id)
  await supabase.from('recipe_meal_plans').delete().eq('id', id)
  if (a.error) throw a.error
}

type Snap = { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null }
const EMPTY_SNAP: Snap = { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null }

// Confirm a PLANNED entry as EATEN — the "nasıl onaylıcam?" flip. Computes a
// fresh macro snapshot from the source (recipe/ingredient) so it now counts in
// the day's ring, then post-061 flips the SAME row's status; pre-061 it moves
// the row from recipe_meal_plans into food_log_entries.
export async function eatPlannedEntry(entry: MealPlanEntry): Promise<void> {
  let snap: Snap = EMPTY_SNAP
  let quantity: number | null = null
  let unit: string | null = null
  if (entry.recipe_id) {
    const { data } = await supabase.from('recipes').select('*').eq('id', entry.recipe_id).maybeSingle()
    if (data) { snap = recipeSnapshot(data as Recipe, entry.servings || 1); quantity = entry.servings || 1; unit = 'serving' }
  } else if (entry.library_ingredient_id) {
    const { data } = await supabase.from('recipe_ingredient_library').select('*').eq('id', entry.library_ingredient_id).maybeSingle()
    const grams = entry.ingredient_quantity ?? 0
    if (data) { snap = ingredientSnapshot(data as IngredientLibraryItem, grams); quantity = grams; unit = entry.ingredient_unit ?? 'g' }
  }
  // Post-061: flip this row planned → eaten with the snapshot.
  const upd = await supabase.from('food_log_entries').update({ status: 'eaten', quantity, unit, ...snap }).eq('id', entry.id)
  if (!upd.error) return
  if (!isMissingStatus(upd.error)) throw upd.error
  // Pre-061: the planned row is in recipe_meal_plans → move it to the diary.
  const user = await requireUser()
  await supabase.from('recipe_meal_plans').delete().eq('id', entry.id)
  const ins = await supabase.from('food_log_entries').insert({
    user_id: user.id, date: entry.date, meal_slot: entry.meal_slot,
    recipe_id: entry.recipe_id, library_ingredient_id: entry.library_ingredient_id, custom_title: entry.custom_title,
    quantity, unit, ...snap,
  })
  if (ins.error) throw ins.error
}
