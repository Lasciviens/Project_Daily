import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { MealPlanEntry, CreateMealPlanEntryInput } from '../types'

export async function fetchMealPlan(weekStart: string, weekEnd: string): Promise<MealPlanEntry[]> {
  const { data, error } = await supabase
    .from('recipe_meal_plans')
    .select('*, recipe:recipes(id, title, calories), ingredient:recipe_ingredient_library(id, name)')
    .gte('date', weekStart)
    .lte('date', weekEnd)
  if (error) throw error
  return data ?? []
}

// Insert a new plan entry, or update-by-id when editing. NOTE: this used to
// .upsert(onConflict:'user_id,date,meal_slot'), but migration 053 DROPPED the
// unique index on that triple (a slot can now hold multiple items), so the
// upsert hit Postgres 42P10 "no unique or exclusion constraint matching the ON
// CONFLICT specification" on EVERY save — the entire Meal Plan tab was broken.
// id present → update that row; absent → plain insert (multiple rows/slot OK).
export async function setMealPlanEntry(input: CreateMealPlanEntryInput): Promise<void> {
  const user = await requireUser()
  const row = {
    date:                  input.date,
    meal_slot:             input.meal_slot,
    recipe_id:             input.recipe_id ?? null,
    custom_title:          input.custom_title ?? null,
    library_ingredient_id: input.library_ingredient_id ?? null,
    ingredient_quantity:   input.ingredient_quantity ?? null,
    ingredient_unit:       input.ingredient_unit ?? null,
    servings:              input.servings ?? 1,
    notes:                 input.notes ?? null,
  }
  const { error } = input.id
    ? await supabase.from('recipe_meal_plans').update(row).eq('id', input.id)
    : await supabase.from('recipe_meal_plans').insert({ ...row, user_id: user.id })
  if (error) throw error
}

export async function deleteMealPlanEntry(id: string): Promise<void> {
  const { error } = await supabase.from('recipe_meal_plans').delete().eq('id', id)
  if (error) throw error
}
