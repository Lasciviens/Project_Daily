import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { ingredientSnapshot, recipeSnapshot } from './foodLogApi'
import { WEIGHT_UNITS } from './recipesApi'
import { plannedKcal, plannedRow, type PlanMacros } from '../mealPlanRows'
import type { MealPlanEntry, CreateMealPlanEntryInput, FoodLogEntryInput, Recipe, IngredientLibraryItem } from '../types'

// The PLAN now lives in `food_log_entries` as status='planned' rows (migration
// 061 merged the old `recipe_meal_plans` table in). This module is the adapter
// between that one table and the MealPlanEntry view-model the plan grid and the
// edit popup use. A food or recipe plan row carries NO macro snapshot
// (computed live on read — `kcal` below); its amount lives in quantity/unit
// (recipe → servings·'serving'; library → grams·unit); a one-off line keeps
// its typed values. Planning from the logger writes the same shapes
// (`addPlannedEntries`, `mealPlanRows.plannedRow`). Pre-061 (the `status`
// column absent) every path falls back to the original recipe_meal_plans table.

/** A planned row for the plan grid: its kcal worked out live (null when it can't be counted). */
export type PlannedMeal = MealPlanEntry & { kcal: number | null }

function isMissingStatus(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /status/i.test(x?.message ?? '')
}

type IngredientEmbed = { id: string; name: string; calories: number | null } | null

interface PlanRow extends PlanMacros {
  id: string; user_id: string; date: string; meal_slot: MealPlanEntry['meal_slot']
  recipe_id: string | null; library_ingredient_id: string | null; custom_title: string | null
  quantity: number | null; unit: string | null; created_at: string
  recipe: MealPlanEntry['recipe']; ingredient: IngredientEmbed
}

// food_log_entries planned row → the plan view-model.
function rowToEntry(r: PlanRow): PlannedMeal {
  const entry: MealPlanEntry = {
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
  return { ...entry, kcal: plannedKcal({ ...entry, ingredient: r.ingredient, calories: r.calories }) }
}

// Pre-061 rows are already in the view-model's shape; they never had a one-off kcal.
type LegacyPlanRow = Omit<MealPlanEntry, 'ingredient'> & { ingredient?: IngredientEmbed }
const legacyToMeal = (e: LegacyPlanRow): PlannedMeal => ({ ...e, kcal: plannedKcal(e) })

const PLAN_SELECT = '*, recipe:recipes(id, title, calories), ingredient:recipe_ingredient_library(id, name, calories)'

export async function fetchMealPlan(weekStart: string, weekEnd: string): Promise<PlannedMeal[]> {
  const q = () => supabase.from('food_log_entries').select(PLAN_SELECT).gte('date', weekStart).lte('date', weekEnd)
  const { data, error } = await q().eq('status', 'planned')
  if (!error) return ((data ?? []) as unknown as PlanRow[]).map(rowToEntry)
  if (!isMissingStatus(error)) throw error
  // pre-061: read the original table (already in the MealPlanEntry shape).
  const legacy = await supabase
    .from('recipe_meal_plans')
    .select(PLAN_SELECT)
    .gte('date', weekStart).lte('date', weekEnd)
  if (legacy.error) throw legacy.error
  return ((legacy.data ?? []) as LegacyPlanRow[]).map(legacyToMeal)
}

/** One planned row by id. Pre-061 the id belongs to recipe_meal_plans instead. */
export async function fetchMealPlanEntry(id: string): Promise<PlannedMeal | null> {
  const { data, error } = await supabase.from('food_log_entries').select(PLAN_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  if (data) return rowToEntry(data as unknown as PlanRow)
  // Post-061 the legacy table is gone; its error just means "not found".
  const legacy = await supabase.from('recipe_meal_plans').select(PLAN_SELECT).eq('id', id).maybeSingle()
  return legacy.error || !legacy.data ? null : legacyToMeal(legacy.data as LegacyPlanRow)
}

type Snap = { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null }
const EMPTY_SNAP: Snap = { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null }

// Map the edit popup's plan-input to a food_log_entries 'planned' row: the
// amount goes into quantity/unit. A food or recipe stores no totals (live on
// read); a one-off line's typed values are left as they are.
function planInputRow(input: CreateMealPlanEntryInput) {
  const isRecipe = !!input.recipe_id
  const isLib = !!input.library_ingredient_id
  return {
    date: input.date, meal_slot: input.meal_slot, status: 'planned' as const,
    recipe_id: input.recipe_id ?? null,
    library_ingredient_id: input.library_ingredient_id ?? null,
    custom_title: input.custom_title ?? null,
    quantity: isRecipe ? (input.servings ?? 1) : isLib ? (input.ingredient_quantity ?? null) : null,
    unit:     isRecipe ? 'serving' : isLib ? (input.ingredient_unit ?? 'g') : null,
    ...(isRecipe || isLib ? EMPTY_SNAP : {}),
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

/** The legacy plan-input for a logger row (pre-061 fallback only). */
function legacyInput(e: FoodLogEntryInput): CreateMealPlanEntryInput {
  const at = { date: e.date, meal_slot: e.meal_slot }
  if (e.recipe_id) return { ...at, recipe_id: e.recipe_id, servings: e.quantity ?? 1 }
  if (e.library_ingredient_id) return { ...at, library_ingredient_id: e.library_ingredient_id, ingredient_quantity: e.quantity ?? null, ingredient_unit: e.unit ?? 'g' }
  return { ...at, custom_title: e.custom_title ?? null }
}

/**
 * Plans the logger's rows (its plan mode): the same row shapes as a log, as
 * status 'planned' (`mealPlanRows.plannedRow`). Returns the new ids (what an
 * Undo removes).
 */
export async function addPlannedEntries(entries: FoodLogEntryInput[]): Promise<string[]> {
  if (entries.length === 0) return []
  const user = await requireUser()
  const ins = await supabase.from('food_log_entries')
    .insert(entries.map(e => ({ ...plannedRow(e), user_id: user.id })))
    .select('id')
  if (!ins.error) return (ins.data ?? []).map(r => String((r as { id: string }).id))
  if (!isMissingStatus(ins.error)) throw ins.error
  // pre-061: the plan is the original table.
  const legacy = await supabase.from('recipe_meal_plans')
    .insert(entries.map(e => ({ ...legacyRow(legacyInput(e)), user_id: user.id })))
    .select('id')
  if (legacy.error) throw legacy.error
  return (legacy.data ?? []).map(r => String((r as { id: string }).id))
}

/** Edits one planned row in place (the edit popup); a one-off line's typed values stay as they are. */
export async function setMealPlanEntry(input: CreateMealPlanEntryInput): Promise<void> {
  const user = await requireUser()
  const row = planInputRow(input)
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

// Confirm a PLANNED entry as EATEN — the "nasıl onaylıcam?" flip. Computes a
// fresh macro snapshot from the source (recipe/ingredient) so it now counts in
// the day's ring, then post-061 flips the SAME row's status; pre-061 it moves
// the row from recipe_meal_plans into food_log_entries.
export async function eatPlannedEntry(entry: MealPlanEntry): Promise<void> {
  // A one-off line has no source to count from: it keeps what was typed
  // (writing the empty snapshot over it turned a planned "Kebab 700 kcal" into 0 kcal).
  if (!entry.recipe_id && !entry.library_ingredient_id) {
    const own = await supabase.from('food_log_entries').update({ status: 'eaten' }).eq('id', entry.id)
    if (!own.error) return
    if (!isMissingStatus(own.error)) throw own.error
  }
  let snap: Snap = EMPTY_SNAP
  let quantity: number | null = null
  let unit: string | null = null
  if (entry.recipe_id) {
    // A failed read must stop here: flipping with null quantity would leave a
    // permanent 0 kcal row nothing ever recalculates.
    const { data, error } = await supabase.from('recipes').select('*').eq('id', entry.recipe_id).maybeSingle()
    if (error) throw error
    quantity = entry.servings || 1; unit = 'serving'
    if (data) snap = recipeSnapshot(data as Recipe, quantity)
  } else if (entry.library_ingredient_id) {
    const { data, error } = await supabase.from('recipe_ingredient_library').select('*').eq('id', entry.library_ingredient_id).maybeSingle()
    if (error) throw error
    // No amount on the plan → the food's own portion (100 g without one), never 0.
    const lib = data as IngredientLibraryItem | null
    const grams = entry.ingredient_quantity ?? lib?.serving_grams ?? 100
    const unitOk = WEIGHT_UNITS.has((entry.ingredient_unit ?? 'g').trim().toLowerCase())
    // REAL BUG, fixed: this used to snapshot `ingredientSnapshot(data, grams)`
    // unconditionally, treating ANY quantity as grams — a non-weight unit
    // (e.g. "2 piece") got scaled as if it were "2 grams" the moment it was
    // confirmed eaten, permanently logging near-zero macros for what might be
    // a whole egg. Every other reader of a planned row (dayNutritionApi's
    // unifiedToMeal, recipesApi's sumMacros) already zeroes the contribution
    // for a non-weight/volume unit — this is the same gate, so "still
    // planned" and "just confirmed eaten" agree instead of silently
    // diverging the instant you tap ✓.
    if (data && unitOk) { snap = ingredientSnapshot(data as IngredientLibraryItem, grams); quantity = grams; unit = entry.ingredient_unit ?? 'g' }
    else if (lib?.serving_grams && entry.ingredient_quantity != null) {
      // "2 pcs" of a food with a portion preset (1 egg = 50 g) → 100 g.
      const g = entry.ingredient_quantity * lib.serving_grams
      snap = ingredientSnapshot(lib, g); quantity = g; unit = 'g'
    } else { quantity = grams; unit = entry.ingredient_unit ?? 'g' }
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
