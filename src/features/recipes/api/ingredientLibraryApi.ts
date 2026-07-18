import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { IngredientLibraryItem, CreateIngredientLibraryItemInput } from '../types'

export async function fetchIngredientLibrary(): Promise<IngredientLibraryItem[]> {
  const { data, error } = await supabase
    .from('recipe_ingredient_library')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createIngredientLibraryItem(input: CreateIngredientLibraryItemInput): Promise<IngredientLibraryItem> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('recipe_ingredient_library')
    .insert({
      user_id:   user.id,
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
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateIngredientLibraryItem(id: string, input: CreateIngredientLibraryItemInput): Promise<IngredientLibraryItem> {
  const { data, error } = await supabase
    .from('recipe_ingredient_library')
    .update({
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
    })
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
