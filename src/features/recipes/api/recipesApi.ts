import { supabase } from '../../../integrations/supabase/client'
import type { RecipeWithIngredients, RecipeInput, RecipeIngredient } from '../types'

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
      user_id:    userId,
      recipe_id:  recipeId,
      name:       i.name.trim(),
      quantity:   i.quantity,
      unit:       i.unit?.trim() || null,
      note:       i.note?.trim() || null,
      sort_order: idx,
    }))
  if (rows.length) {
    const { error } = await supabase.from('recipe_ingredients').insert(rows)
    if (error) throw error
  }
}

export async function createRecipe(input: RecipeInput): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('recipes')
    .insert({
      user_id:      user.id,
      title:        input.title.trim(),
      description:  input.description ?? null,
      servings:     input.servings,
      instructions: input.instructions ?? null,
      calories:     input.calories ?? null,
      protein_g:    input.protein_g ?? null,
      carbs_g:      input.carbs_g ?? null,
      fat_g:        input.fat_g ?? null,
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('recipes')
    .update({
      title:        input.title.trim(),
      description:  input.description ?? null,
      servings:     input.servings,
      instructions: input.instructions ?? null,
      calories:     input.calories ?? null,
      protein_g:    input.protein_g ?? null,
      carbs_g:      input.carbs_g ?? null,
      fat_g:        input.fat_g ?? null,
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
