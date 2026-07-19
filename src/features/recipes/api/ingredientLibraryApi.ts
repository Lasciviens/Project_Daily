import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { IngredientLibraryItem, CreateIngredientLibraryItemInput } from '../types'

function sortPortions(item: IngredientLibraryItem): IngredientLibraryItem {
  if (item.portions) item.portions.sort((a, b) => a.sort_order - b.sort_order)
  return item
}

export async function fetchIngredientLibrary(): Promise<IngredientLibraryItem[]> {
  // Hydrate the portion presets (migration 057). If that table doesn't exist
  // yet (pre-057), the embed errors the whole query — fall back to a plain read.
  const { data, error } = await supabase
    .from('recipe_ingredient_library')
    .select('*, portions:recipe_ingredient_portions(id, library_ingredient_id, label, grams, sort_order)')
    .order('name', { ascending: true })
  if (!error) return ((data ?? []) as IngredientLibraryItem[]).map(sortPortions)

  const { data: plain, error: e2 } = await supabase
    .from('recipe_ingredient_library')
    .select('*')
    .order('name', { ascending: true })
  if (e2) throw e2
  return plain ?? []
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
    const { data: existing } = await supabase
      .from('recipe_ingredient_library')
      .select('*')
      .eq('user_id', user.id)
      .eq('source_ref', input.source_ref.trim())
      .maybeSingle()
    if (existing) return existing as IngredientLibraryItem
  }
  return createIngredientLibraryItem(input)
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
  if (error) throw error
  return data
}

export async function updateIngredientLibraryItem(id: string, input: CreateIngredientLibraryItemInput): Promise<IngredientLibraryItem> {
  const { data, error } = await supabase
    .from('recipe_ingredient_library')
    .update(libraryRow(input))
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteIngredientLibraryItem(id: string): Promise<void> {
  const { error } = await supabase.from('recipe_ingredient_library').delete().eq('id', id)
  if (error) throw error
}
