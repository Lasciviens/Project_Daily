import { supabase } from '../../../integrations/supabase/client'
import type { MealPlanEntry, CreateMealPlanEntryInput } from '../types'

export async function fetchMealPlan(weekStart: string, weekEnd: string): Promise<MealPlanEntry[]> {
  const { data, error } = await supabase
    .from('meal_plan_entries')
    .select('*, recipe:recipes(id, title, calories)')
    .gte('date', weekStart)
    .lte('date', weekEnd)
  if (error) throw error
  return data ?? []
}

// Upserts on (user_id, date, meal_slot) — one entry per slot per day.
export async function setMealPlanEntry(input: CreateMealPlanEntryInput): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { error } = await supabase
    .from('meal_plan_entries')
    .upsert({
      user_id:      user.id,
      date:         input.date,
      meal_slot:    input.meal_slot,
      recipe_id:    input.recipe_id ?? null,
      custom_title: input.custom_title ?? null,
      servings:     input.servings ?? 1,
      notes:        input.notes ?? null,
    }, { onConflict: 'user_id,date,meal_slot' })
  if (error) throw error
}

export async function deleteMealPlanEntry(id: string): Promise<void> {
  const { error } = await supabase.from('meal_plan_entries').delete().eq('id', id)
  if (error) throw error
}
