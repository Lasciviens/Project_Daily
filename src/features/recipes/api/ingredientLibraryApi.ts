import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { IngredientLibraryItem, CreateIngredientLibraryItemInput } from '../types'

export async function fetchIngredientLibrary(): Promise<IngredientLibraryItem[]> {
  // Per-100g food catalog. The old recipe_ingredient_portions preset table was
  // dead (never written, empty) and is dropped in migration 061 — the food's
  // single serving_label/serving_grams covers the "1 scoop = 30g" case.
  const { data, error } = await supabase
    .from('recipe_ingredient_library')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

// Shared column payload. `food_group` is included ONLY when set — so editing a
// food's macros still works before migration 057 adds that column (graceful
// degradation); setting a category needs 057 applied.
function libraryRow(input: CreateIngredientLibraryItemInput) {
  const row: Record<string, unknown> = {
    name:      input.name.trim(),
    unit:      input.unit?.trim() || 'g',
    calories:  input.calories  ?? null,
    protein_g: input.protein_g ?? null,
    carbs_g:   input.carbs_g   ?? null,
    fat_g:     input.fat_g     ?? null,
    fiber_g:   input.fiber_g   ?? null,
    sugar_g:   input.sugar_g   ?? null,
    serving_label: input.serving_label?.trim() || null,
    serving_grams: input.serving_grams ?? null,
  }
  // Included only when set → editing a food's macros still works before the
  // enrichment columns exist (graceful degradation). food_group needs mig 057;
  // image_url needs mig 059; source/source_ref need mig 055.
  if (input.food_group?.trim())    row.food_group    = input.food_group.trim()
  if (input.food_group_id?.trim()) row.food_group_id = input.food_group_id.trim()
  if (input.image_url?.trim())     row.image_url     = input.image_url.trim()
  if (input.source?.trim())        row.source        = input.source.trim()
  if (input.source_ref?.trim())    row.source_ref    = input.source_ref.trim()
  return row
}

// Add-to-library-on-first-use: upsert an external food (barcode/branded/generic
// search result) keyed by its provenance id (source_ref = EAN/foodId), so the
// same product never creates a duplicate. Returns the surviving library row.
export async function upsertExternalFood(input: CreateIngredientLibraryItemInput): Promise<IngredientLibraryItem> {
  const user = await requireUser()
  if (input.source_ref?.trim()) {
    const { data: existing, error } = await supabase
      .from('recipe_ingredient_library')
      .select('*')
      .eq('user_id', user.id)
      .eq('source_ref', input.source_ref.trim())
      .limit(1)
    if (error) throw error
    if (existing?.[0]) return existing[0] as IngredientLibraryItem
  }
  // Names are unique per user: a product whose name is already in the library
  // is that food, not a duplicate (an insert would fail with a raw 23505).
  const same = await findFoodByName(input.name)
  if (same) return same
  return createIngredientLibraryItem(input)
}

/** The library food with this exact name (case ignored), if any. */
export async function findFoodByName(name: string): Promise<IngredientLibraryItem | null> {
  const user = await requireUser()
  const n = name.trim()
  if (!n) return null
  const pattern = n.replace(/[\\%_]/g, m => '\\' + m)
  const { data, error } = await supabase.from('recipe_ingredient_library').select('*')
    .eq('user_id', user.id).ilike('name', pattern).limit(1)
  if (error) throw error
  return (data?.[0] as IngredientLibraryItem | undefined) ?? null
}

export async function createIngredientLibraryItem(input: CreateIngredientLibraryItemInput): Promise<IngredientLibraryItem> {
  const user = await requireUser()
  const row: Record<string, unknown> = { user_id: user.id, ...libraryRow(input) }
  let { data, error } = await supabase.from('recipe_ingredient_library').insert(row).select().single()
  // Graceful pre-migration-059 fallback: image_url column may not exist yet —
  // drop it and retry so a barcode save still works (image just isn't stored).
  if (error && 'image_url' in row && /image_url/i.test(error.message)) {
    delete row.image_url
    ;({ data, error } = await supabase.from('recipe_ingredient_library').insert(row).select().single())
  }
  if (error && (error as { code?: string }).code === '23505') throw new Error(`“${input.name.trim()}” is already in your foods — edit that one instead`)
  if (error) throw error
  return data
}

export async function updateIngredientLibraryItem(id: string, input: CreateIngredientLibraryItemInput): Promise<IngredientLibraryItem> {
  const row: Record<string, unknown> = libraryRow(input)
  // An edit that clears the category sends null (create leaves it out).
  if ('food_group' in input && !input.food_group?.trim()) { row.food_group = null; row.food_group_id = null }
  let { data, error } = await supabase.from('recipe_ingredient_library').update(row).eq('id', id).select().single()
  // Same graceful pre-059 fallback as create: image_url column may not exist yet.
  if (error && 'image_url' in row && /image_url/i.test(error.message)) {
    delete row.image_url
    ;({ data, error } = await supabase.from('recipe_ingredient_library').update(row).eq('id', id).select().single())
  }
  if (error && (error as { code?: string }).code === '23505') throw new Error(`Another food is already called “${input.name.trim()}”`)
  if (error) throw error
  return data
}

/** How many recipes (incl. saved meals) use a library food — shown before deleting it. */
export async function countRecipesUsingIngredient(id: string): Promise<number> {
  const { data, error } = await supabase.from('recipe_ingredients').select('recipe_id').eq('library_ingredient_id', id)
  if (error) throw error
  return new Set((data ?? []).map(r => r.recipe_id as string)).size
}

export async function deleteIngredientLibraryItem(id: string): Promise<void> {
  // Recipes calculated from this food keep the totals they have (switch to
  // manual) — otherwise they, and every past day they were eaten, would drop
  // this food's calories. Migration 123 does the same in the database.
  const { data: links, error: linkError } = await supabase.from('recipe_ingredients').select('recipe_id').eq('library_ingredient_id', id)
  if (linkError) throw linkError
  const recipeIds = [...new Set((links ?? []).map(l => l.recipe_id as string))]
  if (recipeIds.length) {
    const { error: freezeError } = await supabase.from('recipes').update({ macro_mode: 'manual' })
      .in('id', recipeIds).eq('macro_mode', 'from_ingredients')
    if (freezeError) throw freezeError
  }
  const { error } = await supabase.from('recipe_ingredient_library').delete().eq('id', id)
  if (error) throw error
}
