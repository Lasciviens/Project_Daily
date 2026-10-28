import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { toGrams } from '../foodUnits'
import type { Recipe, RecipeWithIngredients, RecipeInput, RecipeIngredient, IngredientLibraryItem } from '../types'

// An EATEN row's units that 106's trigger recalculates (food_is_weight_unit):
// the diary stores g / ml. Recipes and planned rows count through foodUnits.
export const WEIGHT_UNITS = new Set(['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'])

export interface ComputedMacros {
  calories:  number | null
  protein_g: number | null
  carbs_g:   number | null
  fat_g:     number | null
  fiber_g:   number | null
  sugar_g:   number | null
  /** Ingredients that couldn't contribute (no library link, or a non-weight
   *  unit we can't convert against the library's per-100g basis). */
  skippedCount: number
}

interface MacroTotals { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number; sugar_g: number }
interface MacroSource { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null }

// Sums each linked ingredient's per-100g macros × quantity/100. Library
// macros are always "per 100g" — see migration 033 — so an ingredient only
// contributes when its unit is a weight/volume unit we treat as equivalent to
// grams (ml ≈ g for this purpose); anything else is skipped. Shared by the
// authoritative save-time computation below and RecipeModal's live preview
// (which passes an already-loaded library map instead of fetching one).
export function sumMacros(
  ingredients: Array<{ library_ingredient_id: string | null; unit: string | null; quantity: number | null }>,
  libraryMap: Map<string, MacroSource>,
): { contributed: boolean; skippedCount: number; totals: MacroTotals } {
  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0 }
  let contributed = false
  let skippedCount = 0

  for (const ing of ingredients) {
    if (!ing.library_ingredient_id) continue
    const lib = libraryMap.get(ing.library_ingredient_id)
    const grams = toGrams(ing.quantity, ing.unit)
    if (!lib || grams == null) { skippedCount++; continue }
    const factor = grams / 100
    totals.calories  += (lib.calories  ?? 0) * factor
    totals.protein_g += (lib.protein_g ?? 0) * factor
    totals.carbs_g   += (lib.carbs_g   ?? 0) * factor
    totals.fat_g     += (lib.fat_g     ?? 0) * factor
    totals.fiber_g   += (lib.fiber_g   ?? 0) * factor
    totals.sugar_g   += (lib.sugar_g   ?? 0) * factor
    contributed = true
  }

  return { contributed, skippedCount, totals }
}

/**
 * True when every named ingredient can feed the per-100g computation: linked to
 * the library, a weight/volume unit and a quantity. A recipe like this is really
 * "from ingredients" even if it was stored as manual — the logger's "Save meal"
 * used to store it that way, which froze its calories at save time.
 */
export function canComputeFromIngredients(
  ingredients: Array<{ name?: string | null; library_ingredient_id: string | null; unit: string | null; quantity: number | null }>,
): boolean {
  const named = ingredients.filter(i => (i.name ?? '').trim() || i.library_ingredient_id)
  return named.length > 0 && named.every(i =>
    !!i.library_ingredient_id && toGrams(i.quantity, i.unit) != null)
}

export async function computeMacrosFromIngredients(
  ingredients: RecipeInput['ingredients'],
  servings: number,
): Promise<ComputedMacros> {
  const linkedIds = [...new Set(ingredients.map(i => i.library_ingredient_id).filter((id): id is string => !!id))]
  const libraryMap = new Map<string, IngredientLibraryItem>()
  if (linkedIds.length) {
    const { data, error } = await supabase.from('recipe_ingredient_library').select('*').in('id', linkedIds)
    if (error) throw error
    for (const row of data ?? []) libraryMap.set(row.id, row)
  }

  const { contributed, skippedCount, totals } = sumMacros(ingredients, libraryMap)
  const perServing = (v: number) => Math.round((v / Math.max(1, servings)) * 10) / 10
  return contributed
    ? {
        calories:  perServing(totals.calories),
        protein_g: perServing(totals.protein_g),
        carbs_g:   perServing(totals.carbs_g),
        fat_g:     perServing(totals.fat_g),
        fiber_g:   perServing(totals.fiber_g),
        sugar_g:   perServing(totals.sugar_g),
        skippedCount,
      }
    : { calories: null, protein_g: null, carbs_g: null, fat_g: null, fiber_g: null, sugar_g: null, skippedCount }
}

export async function fetchRecipes(): Promise<RecipeWithIngredients[]> {
  const { data, error } = await supabase
    .from('recipes')
    .select('*, ingredients:recipe_ingredients(*)')
    .order('created_at', { ascending: false })
  if (error) throw error
  // Sort each recipe's ingredients by sort_order (nested order isn't guaranteed).
  return (data ?? []).map(r => ({
    ...r,
    ingredients: (r.ingredients ?? []).sort(
      (a: RecipeIngredient, b: RecipeIngredient) => a.sort_order - b.sort_order,
    ),
  }))
}

async function replaceIngredients(userId: string, recipeId: string, ingredients: RecipeInput['ingredients']) {
  // One transaction (migration 123): a failed insert can no longer leave the
  // recipe without ingredients.
  const payload = ingredients.filter(i => i.name.trim()).map(i => ({
    name: i.name.trim(), quantity: i.quantity, unit: i.unit?.trim() || null,
    note: i.note?.trim() || null, library_ingredient_id: i.library_ingredient_id,
  }))
  const { error: rpcError } = await supabase.rpc('replace_recipe_ingredients', { p_recipe_id: recipeId, p_rows: payload })
  if (!rpcError) return
  const code = (rpcError as { code?: string }).code
  if (code !== 'PGRST202' && code !== '42883') throw rpcError

  // Before 123: delete, then insert. A failed delete followed by the insert would duplicate every ingredient.
  const { error: delError } = await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId)
  if (delError) throw delError
  const rows = ingredients
    .filter(i => i.name.trim())
    .map((i, idx) => ({
      user_id:               userId,
      recipe_id:             recipeId,
      name:                  i.name.trim(),
      quantity:              i.quantity,
      unit:                  i.unit?.trim() || null,
      note:                  i.note?.trim() || null,
      sort_order:            idx,
      library_ingredient_id: i.library_ingredient_id,
    }))
  if (rows.length) {
    const { error } = await supabase.from('recipe_ingredients').insert(rows)
    if (error) throw error
  }
}

// When macro_mode is 'from_ingredients', the manual macro fields on the input
// are overridden by a fresh computation — the ingredient list is always the
// source of truth in that mode, never a stale typed-in number.
async function resolveMacros(input: RecipeInput) {
  if (input.macro_mode !== 'from_ingredients') {
    return {
      calories: input.calories ?? null, protein_g: input.protein_g ?? null,
      carbs_g: input.carbs_g ?? null, fat_g: input.fat_g ?? null,
      fiber_g: input.fiber_g ?? null, sugar_g: input.sugar_g ?? null,
    }
  }
  const computed = await computeMacrosFromIngredients(input.ingredients, input.servings)
  return {
    calories: computed.calories, protein_g: computed.protein_g,
    carbs_g: computed.carbs_g, fat_g: computed.fat_g,
    fiber_g: computed.fiber_g, sugar_g: computed.sugar_g,
  }
}

// Some recipe columns land in later migrations (fiber_g = 060, is_temp = 066,
// the portion name and batch = 157). Until applied, an insert/update carrying
// one 400s with "column not found" (PGRST204 / 42703). Detect that specific
// case per-column and retry without it so a pre-migration browser still saves
// (matches the image_url degradation pattern). Every other error propagates
// unchanged. Remove the 157 names once 157 has run everywhere.
const OPTIONAL_RECIPE_COLS = ['is_temp', 'fiber_g', 'serving_label'] as const
function missingRecipeCol(err: unknown, col: string): boolean {
  const e = err as { code?: string; message?: string }
  const msg = (e?.message ?? '').toLowerCase()
  return (e?.code === 'PGRST204' || e?.code === '42703') && msg.includes(col)
}

/** Runs a write, dropping each optional column the database names as missing (in any order) and retrying. */
async function writeDroppingMissing<T extends { error: unknown }>(row: Record<string, unknown>, write: () => PromiseLike<T>): Promise<T> {
  let res = await write()
  for (;;) {
    const col = OPTIONAL_RECIPE_COLS.find(c => c in row && missingRecipeCol(res.error, c))
    if (!res.error || !col) return res
    delete row[col]
    res = await write()
  }
}

export async function createRecipe(input: RecipeInput): Promise<string> {
  const user = await requireUser()

  const macros = await resolveMacros(input)
  const row: Record<string, unknown> = {
    user_id:      user.id,
    title:        input.title.trim(),
    description:  input.description ?? null,
    servings:     input.servings,
    instructions: input.instructions ?? null,
    macro_mode:   input.macro_mode,
    ...macros,
    image_url:    input.image_url ?? null,
    source_url:   input.source_url ?? null,
    category:     input.category ?? null,
    is_temp:      input.is_temp ?? false,
  }
  if (input.serving_label !== undefined) row.serving_label = cleanServingLabel(input.serving_label)
  const { data, error } = await writeDroppingMissing(row, () => supabase.from('recipes').insert(row).select('id').single())
  if (error) throw error
  if (!data) throw new Error('Recipe insert returned no row')

  await replaceIngredients(user.id, data.id, input.ingredients)
  // The logger's Save meal: the batch it made starts on the server's clock.
  // Before 157 there are no batches — the save itself is what counts.
  if (input.start_batch && input.start_batch > 0) {
    try { await startRecipeBatch(data.id, { servings: input.start_batch }) } catch (e) { if ((e as Error).message !== NOT_MIGRATED_157) throw e }
  }
  return data.id
}

export async function updateRecipe(id: string, input: RecipeInput): Promise<void> {
  const user = await requireUser()

  const macros = await resolveMacros(input)
  const row: Record<string, unknown> = {
    title:        input.title.trim(),
    description:  input.description ?? null,
    servings:     input.servings,
    instructions: input.instructions ?? null,
    macro_mode:   input.macro_mode,
    ...macros,
    image_url:    input.image_url ?? null,
    source_url:   input.source_url ?? null,
    category:     input.category ?? null,
    updated_at:   new Date().toISOString(),
  }
  if (input.is_temp !== undefined) row.is_temp = input.is_temp
  if (input.serving_label !== undefined) row.serving_label = cleanServingLabel(input.serving_label)
  const { error } = await writeDroppingMissing(row, () => supabase.from('recipes').update(row).eq('id', id))
  if (error) throw error

  await replaceIngredients(user.id, id, input.ingredients)
}

/**
 * A library ingredient's macros changed: recompute the stored per-serving macros
 * of every recipe that is calculated from its ingredients and uses it (plus
 * manual recipes whose ingredients are all library-linked by weight — only the
 * logger's old "Save meal" made those, since links are only editable in
 * 'from_ingredients' mode — which are switched to 'from_ingredients'). Without this, recipe and planned-meal
 * calories kept the old numbers forever. Returns the ids of the recipes updated,
 * so their eaten diary rows can be recalculated too. Migration 106's triggers do
 * the same in the database; this keeps the web app correct before it is applied.
 */
export async function recomputeRecipesUsingIngredient(libraryId: string): Promise<string[]> {
  const { data: links, error: linkError } = await supabase
    .from('recipe_ingredients').select('recipe_id').eq('library_ingredient_id', libraryId)
  if (linkError) throw linkError
  const ids = [...new Set((links ?? []).map(l => l.recipe_id as string))]
  if (!ids.length) return []

  const { data: recipes, error } = await supabase
    .from('recipes').select('*, ingredients:recipe_ingredients(*)').in('id', ids)
  if (error) throw error

  const updated: string[] = []
  for (const r of (recipes ?? []) as RecipeWithIngredients[]) {
    // A typed (manual) Library recipe keeps its numbers; only a saved meal
    // from the logger (temp) is switched to follow its ingredients.
    const computable = r.macro_mode === 'from_ingredients'
      || (r.macro_mode === 'manual' && r.is_temp && canComputeFromIngredients(r.ingredients))
    if (!computable) continue
    const m = await computeMacrosFromIngredients(r.ingredients, r.servings)
    const row: Record<string, unknown> = {
      macro_mode: 'from_ingredients',
      calories: m.calories, protein_g: m.protein_g, carbs_g: m.carbs_g,
      fat_g: m.fat_g, fiber_g: m.fiber_g, sugar_g: m.sugar_g,
      updated_at: new Date().toISOString(),
    }
    let { error: upError } = await supabase.from('recipes').update(row).eq('id', r.id)
    if (upError && missingRecipeCol(upError, 'fiber_g')) {
      delete row.fiber_g
      ;({ error: upError } = await supabase.from('recipes').update(row).eq('id', r.id))
    }
    if (upError) throw upError
    updated.push(r.id)
  }
  return updated
}

/** A portion name as stored: trimmed, at most 30 characters (157's guard), empty = null ("portion"). */
export function cleanServingLabel(label: string | null | undefined): string | null {
  const t = (label ?? '').trim().slice(0, 30)
  return t === '' ? null : t
}

export const NOT_MIGRATED_157 = 'Batches need migration 157 (recipe portions and batches), which has not been applied yet.'

/** A recipe's batch as stored. */
export type RecipeBatch = Pick<Recipe, 'id' | 'batch_started_at' | 'batch_servings' | 'batch_cooked_g' | 'times_cooked'>

/**
 * Starts a batch through 157's start_recipe_batch(): the start is the
 * server's now(), never this device's clock — leftovers count diary rows by
 * their server-made created_at, so a phone running fast would otherwise leave
 * a portion logged right after uncounted. `countCook` also counts "I made this".
 */
export async function startRecipeBatch(id: string, b: { servings: number; cookedG?: number | null; countCook?: boolean }): Promise<RecipeBatch> {
  const { data, error } = await supabase.rpc('start_recipe_batch', {
    p_recipe_id: id, p_servings: b.servings, p_cooked_g: b.cookedG ?? null, p_count_cook: b.countCook ?? false,
  })
  if (error) {
    const code = (error as { code?: string }).code
    throw code === 'PGRST202' || code === '42883' ? new Error(NOT_MIGRATED_157) : error
  }
  const row = (Array.isArray(data) ? data[0] : data) as RecipeBatch | undefined
  if (!row) throw new Error('That recipe is no longer there')
  return row
}

/**
 * "I made this": counts the cook and starts a batch of `servings` (the
 * detail's scaled yield), so the portion sheet can say what is left. Before
 * migration 157 only the count is written.
 */
export async function incrementTimesCooked(id: string, current: number, servings?: number): Promise<void> {
  if (servings != null && servings > 0) {
    try { await startRecipeBatch(id, { servings, countCook: true }); return } catch (e) { if ((e as Error).message !== NOT_MIGRATED_157) throw e }
  }
  const { error } = await supabase.from('recipes').update({ times_cooked: current + 1 }).eq('id', id)
  if (error) throw error
}

export interface RecipeBatchPatch {
  /** Starts a new batch now (on the server's clock) of `batch_servings`, with a pot weight or none. */
  start?: boolean
  batch_servings?: number
  /** The weighed pot, grams; null forgets it. */
  batch_cooked_g?: number | null
}

/** "New batch" / the pot's weight in the portion sheet. Returns the stored batch columns. */
export async function updateRecipeBatch(id: string, patch: RecipeBatchPatch): Promise<RecipeBatch> {
  if (patch.start) return startRecipeBatch(id, { servings: patch.batch_servings ?? 1, cookedG: patch.batch_cooked_g ?? null })
  const { data, error } = await supabase.from('recipes').update({ batch_cooked_g: patch.batch_cooked_g ?? null }).eq('id', id)
    .select('id, batch_started_at, batch_servings, batch_cooked_g, times_cooked').single()
  if (error) throw missingRecipeCol(error, 'batch_') ? new Error(NOT_MIGRATED_157) : error
  return data as RecipeBatch
}
