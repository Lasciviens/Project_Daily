import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { RecipeWithIngredients, RecipeInput, RecipeIngredient, IngredientLibraryItem } from '../types'

export const WEIGHT_UNITS = new Set(['g', 'gram', 'grams', 'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'])

export interface ComputedMacros {
  calories:  number | null
  protein_g: number | null
  carbs_g:   number | null
  fat_g:     number | null
  sugar_g:   number | null
  /** Ingredients that couldn't contribute (no library link, or a non-weight
   *  unit we can't convert against the library's per-100g basis). */
  skippedCount: number
}

interface MacroTotals { calories: number; protein_g: number; carbs_g: number; fat_g: number; sugar_g: number }
interface MacroSource { calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; sugar_g: number | null }

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
  const totals = { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, sugar_g: 0 }
  let contributed = false
  let skippedCount = 0

  for (const ing of ingredients) {
    if (!ing.library_ingredient_id) continue
    const lib = libraryMap.get(ing.library_ingredient_id)
    const unitOk = ing.unit && WEIGHT_UNITS.has(ing.unit.trim().toLowerCase())
    if (!lib || !unitOk || ing.quantity == null) { skippedCount++; continue }
    const factor = ing.quantity / 100
    totals.calories  += (lib.calories  ?? 0) * factor
    totals.protein_g += (lib.protein_g ?? 0) * factor
    totals.carbs_g   += (lib.carbs_g   ?? 0) * factor
    totals.fat_g     += (lib.fat_g     ?? 0) * factor
    totals.sugar_g   += (lib.sugar_g   ?? 0) * factor
    contributed = true
  }

  return { contributed, skippedCount, totals }
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
        sugar_g:   perServing(totals.sugar_g),
        skippedCount,
      }
    : { calories: null, protein_g: null, carbs_g: null, fat_g: null, sugar_g: null, skippedCount }
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
  await supabase.from('recipe_ingredients').delete().eq('recipe_id', recipeId)
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
      carbs_g: input.carbs_g ?? null, fat_g: input.fat_g ?? null, sugar_g: input.sugar_g ?? null,
    }
  }
  const computed = await computeMacrosFromIngredients(input.ingredients, input.servings)
  return {
    calories: computed.calories, protein_g: computed.protein_g,
    carbs_g: computed.carbs_g, fat_g: computed.fat_g, sugar_g: computed.sugar_g,
  }
}

export async function createRecipe(input: RecipeInput): Promise<string> {
  const user = await requireUser()

  const macros = await resolveMacros(input)
  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id:      user.id,
      title:        input.title.trim(),
      description:  input.description ?? null,
      servings:     input.servings,
      instructions: input.instructions ?? null,
      macro_mode:   input.macro_mode,
      ...macros,
      image_url:    input.image_url ?? null,
      source_url:   input.source_url ?? null,
    })
    .select('id')
    .single()
  if (error) throw error

  await replaceIngredients(user.id, data.id, input.ingredients)
  return data.id
}

export async function updateRecipe(id: string, input: RecipeInput): Promise<void> {
  const user = await requireUser()

  const macros = await resolveMacros(input)
  const { error } = await supabase
    .from('recipes')
    .update({
      title:        input.title.trim(),
      description:  input.description ?? null,
      servings:     input.servings,
      instructions: input.instructions ?? null,
      macro_mode:   input.macro_mode,
      ...macros,
      image_url:    input.image_url ?? null,
      source_url:   input.source_url ?? null,
      updated_at:   new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error

  await replaceIngredients(user.id, id, input.ingredients)
}

export async function deleteRecipe(id: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id)
  if (error) throw error
}

export async function incrementTimesCooked(id: string, current: number): Promise<void> {
  const { error } = await supabase.from('recipes').update({ times_cooked: current + 1 }).eq('id', id)
  if (error) throw error
}
