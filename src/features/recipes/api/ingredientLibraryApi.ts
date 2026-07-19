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
  if (input.food_group?.trim()) row.food_group = input.food_group.trim()
  return row
}

export async function createIngredientLibraryItem(input: CreateIngredientLibraryItemInput): Promise<IngredientLibraryItem> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('recipe_ingredient_library')
    .insert({ user_id: user.id, ...libraryRow(input) })
    .select()
    .single()
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
