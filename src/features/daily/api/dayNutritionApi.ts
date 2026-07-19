import { supabase } from '../../../integrations/supabase/client'
import { WEIGHT_UNITS } from '../../recipes/api/recipesApi'
import type { MealPlanEntry } from '../../recipes/types'

// A single planned meal for a day, resolved to its display title + macro
// contribution. Macros are the TOTAL for that entry (recipe per-serving ×
// servings, or library ingredient per-100g × quantity/100 for weight/volume
// units). Custom-title entries carry no macros.
export interface DayMeal {
  id:        string
  meal_slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement'
  title:     string
  servings:  number
  calories:  number
  protein_g: number
  carbs_g:   number
  fat_g:     number
  fiber_g:   number
  sugar_g:   number
  /** 'plan' = a status='planned' row (intent, macros computed live); 'log' = a
      status='eaten' row (what was actually eaten, macros snapshotted at log
      time). Both live in food_log_entries since migration 061. */
  source:    'plan' | 'log'
  /** For plan rows only — the raw entry so the Daily ✎ can edit it in place. */
  planEntry?: MealPlanEntry
  /** For log rows only — the raw diary fields so a ✎ can edit the entry in
      place (kind is inferable: library / recipe / custom). */
  logEntry?: {
    library_ingredient_id: string | null
    recipe_id:             string | null
    custom_title:          string | null
    quantity:              number | null
    unit:                  string | null
  }
}

export interface DayNutrition {
  meals:     DayMeal[]
  calories:  number
  protein_g: number
  carbs_g:   number
  fat_g:     number
  fiber_g:   number
  sugar_g:   number
}

// Only weight/volume units let a per-100g library macro be scaled to a real
// amount; a "piece"/"clove"/etc. quantity can't be converted, so it's skipped.
// Shares recipesApi's WEIGHT_UNITS so the two paths never drift (was a local
// narrower set that dropped 'milliliter(s)'/'millilitre(s)').
const SCALABLE_UNITS = WEIGHT_UNITS

interface MealRow {
  id:                    string
  meal_slot:             DayMeal['meal_slot']
  recipe_id:             string | null
  custom_title:          string | null
  library_ingredient_id: string | null
  ingredient_quantity:   number | null
  ingredient_unit:       string | null
  servings:              number | null
  recipe:                { title: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null } | null
  ingredient:            { name: string; unit: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null } | null
}

const SLOT_ORDER: Record<DayMeal['meal_slot'], number> = { breakfast: 0, lunch: 1, dinner: 2, snack: 3, supplement: 4 }

function isMissingStatus(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /status/i.test(x?.message ?? '')
}

// A unified food_log_entries row (post-061): 'planned' (macros live) or 'eaten'
// (macros snapshotted). recipes.fiber_g is intentionally NOT selected (needs
// mig 060; a missing column would error the query) → planned-recipe fiber = 0.
interface UnifiedRow {
  id: string
  meal_slot: DayMeal['meal_slot']
  status: 'planned' | 'eaten'
  recipe_id: string | null
  library_ingredient_id: string | null
  custom_title: string | null
  quantity: number | null
  unit: string | null
  calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null
  recipe:     { title: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; sugar_g: number | null } | null
  ingredient: { name: string; unit: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null } | null
}

const UNIFIED_SELECT =
  'id, meal_slot, status, recipe_id, library_ingredient_id, custom_title, quantity, unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, ' +
  'recipe:recipes(title, calories, protein_g, carbs_g, fat_g, sugar_g), ' +
  'ingredient:recipe_ingredient_library(name, unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g)'

// Exported for unit-testability (the post-061 path can't be exercised against
// an un-migrated DB) — a pure row→DayMeal mapper.
export function unifiedToMeal(row: UnifiedRow, date: string): DayMeal {
  if (row.status === 'planned') {
    // Intent → macros computed LIVE (recipe per-serving × servings, or library
    // per-100g × grams/100 for a weight unit). Custom = no macros.
    const servings = row.quantity ?? 1
    let title = row.custom_title ?? '—'
    let calories = 0, protein_g = 0, carbs_g = 0, fat_g = 0, fiber_g = 0, sugar_g = 0
    if (row.recipe) {
      title = row.recipe.title
      calories = (row.recipe.calories ?? 0) * servings; protein_g = (row.recipe.protein_g ?? 0) * servings
      carbs_g = (row.recipe.carbs_g ?? 0) * servings; fat_g = (row.recipe.fat_g ?? 0) * servings
      sugar_g = (row.recipe.sugar_g ?? 0) * servings
    } else if (row.ingredient) {
      const qty = row.quantity ?? 0
      const factor = SCALABLE_UNITS.has((row.unit ?? '').toLowerCase()) ? qty / 100 : 0
      const qtyLabel = qty ? `${qty}${row.unit ?? ''}` : ''
      title = qtyLabel ? `${row.ingredient.name} · ${qtyLabel}` : row.ingredient.name
      calories = (row.ingredient.calories ?? 0) * factor; protein_g = (row.ingredient.protein_g ?? 0) * factor
      carbs_g = (row.ingredient.carbs_g ?? 0) * factor; fat_g = (row.ingredient.fat_g ?? 0) * factor
      fiber_g = (row.ingredient.fiber_g ?? 0) * factor; sugar_g = (row.ingredient.sugar_g ?? 0) * factor
    }
    return {
      id: row.id, meal_slot: row.meal_slot, title, servings,
      calories: Math.round(calories), protein_g: Math.round(protein_g), carbs_g: Math.round(carbs_g),
      fat_g: Math.round(fat_g), fiber_g: Math.round(fiber_g), sugar_g: Math.round(sugar_g),
      source: 'plan',
      planEntry: {
        id: row.id, date, meal_slot: row.meal_slot, recipe_id: row.recipe_id, custom_title: row.custom_title,
        library_ingredient_id: row.library_ingredient_id,
        ingredient_quantity: row.library_ingredient_id ? row.quantity : null,
        ingredient_unit: row.library_ingredient_id ? row.unit : null,
        servings: row.recipe_id ? servings : 1,
      } as MealPlanEntry,
    }
  }
  // Eaten → the at-log-time snapshot (stored columns), never recomputed.
  const base = row.ingredient?.name ?? row.recipe?.title ?? row.custom_title ?? '—'
  const qtyLabel = row.quantity ? ` · ${row.quantity}${row.unit === 'serving' ? '×' : (row.unit ?? 'g')}` : ''
  return {
    id: row.id, meal_slot: row.meal_slot, title: `${base}${qtyLabel}`, servings: 1,
    calories: Math.round(row.calories ?? 0), protein_g: Math.round(row.protein_g ?? 0), carbs_g: Math.round(row.carbs_g ?? 0),
    fat_g: Math.round(row.fat_g ?? 0), fiber_g: Math.round(row.fiber_g ?? 0), sugar_g: Math.round(row.sugar_g ?? 0),
    source: 'log',
    logEntry: {
      library_ingredient_id: row.library_ingredient_id, recipe_id: row.recipe_id,
      custom_title: row.custom_title, quantity: row.quantity, unit: row.unit,
    },
  }
}

interface LogRow {
  id: string
  meal_slot: DayMeal['meal_slot']
  library_ingredient_id: string | null
  recipe_id: string | null
  custom_title: string | null
  quantity: number | null
  unit: string | null
  calories: number | null
  protein_g: number | null
  carbs_g: number | null
  fat_g: number | null
  fiber_g: number | null
  sugar_g: number | null
  ingredient: { name: string } | null
  recipe: { title: string } | null
}

export async function fetchDayNutrition(date: string): Promise<DayNutrition> {
  // Post-061: ONE table, split by status. Pre-061: the old two-table union.
  const uni = await supabase.from('food_log_entries').select(UNIFIED_SELECT).eq('date', date)
  let allMeals: DayMeal[]
  if (!uni.error) {
    allMeals = ((uni.data ?? []) as unknown as UnifiedRow[])
      .map(r => unifiedToMeal(r, date))
      .sort((a, b) => SLOT_ORDER[a.meal_slot] - SLOT_ORDER[b.meal_slot])
  } else if (isMissingStatus(uni.error)) {
    allMeals = (await legacyTwoTable(date)).sort((a, b) => SLOT_ORDER[a.meal_slot] - SLOT_ORDER[b.meal_slot])
  } else {
    throw uni.error
  }

  // CONSUMED = the DIARY only (source==='log'); planned rows are intent and
  // never feed the ring (double-counted a day that was planned AND eaten).
  const sum = (k: keyof Pick<DayMeal, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g'>) =>
    allMeals.reduce((acc, m) => acc + (m.source === 'log' ? m[k] : 0), 0)

  return {
    meals: allMeals,
    calories:  sum('calories'),
    protein_g: sum('protein_g'),
    carbs_g:   sum('carbs_g'),
    fat_g:     sum('fat_g'),
    fiber_g:   sum('fiber_g'),
    sugar_g:   sum('sugar_g'),
  }
}

// Pre-061 fallback: plan (recipe_meal_plans) + diary (food_log_entries) as two
// tables, unioned. Kept verbatim so an un-migrated environment still works.
async function legacyTwoTable(date: string): Promise<DayMeal[]> {
  const [{ data, error }, { data: logData, error: logError }] = await Promise.all([
    supabase
      .from('recipe_meal_plans')
      .select(
        // recipes.fiber_g is deliberately NOT selected — it needs migration 060,
        // and a missing column would error this (thrown) plan query and break the
        // whole card. Plan-recipe rows don't feed the totals anyway (ring = diary
        // only), so recipe fiber stays 0 here; sugar_g is a pre-existing column.
        '*, recipe:recipes(title, calories, protein_g, carbs_g, fat_g, sugar_g), ' +
        'ingredient:recipe_ingredient_library(name, unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g)'
      )
      .eq('date', date),
    supabase
      .from('food_log_entries')
      .select('id, meal_slot, library_ingredient_id, recipe_id, custom_title, quantity, unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, ' +
        'ingredient:recipe_ingredient_library(name), recipe:recipes(title)')
      .eq('date', date),
  ])

  if (error) throw error
  // food_log_entries may predate migration 053 in a given environment — a
  // missing table must not break the whole nutrition card (plan still shows).
  const logRows: LogRow[] = logError ? [] : ((logData ?? []) as unknown as LogRow[])

  const meals: DayMeal[] = ((data ?? []) as unknown as MealRow[]).map(row => {
    const servings = row.servings ?? 1
    let title = row.custom_title ?? '—'
    let calories = 0, protein_g = 0, carbs_g = 0, fat_g = 0, fiber_g = 0, sugar_g = 0

    if (row.recipe) {
      title = row.recipe.title
      calories  = (row.recipe.calories  ?? 0) * servings
      protein_g = (row.recipe.protein_g ?? 0) * servings
      carbs_g   = (row.recipe.carbs_g   ?? 0) * servings
      fat_g     = (row.recipe.fat_g     ?? 0) * servings
      sugar_g   = (row.recipe.sugar_g   ?? 0) * servings
      // recipe fiber isn't selected pre-migration-060 → fiber stays 0 for plans.
    } else if (row.ingredient) {
      const qty  = row.ingredient_quantity ?? 0
      const unit = (row.ingredient_unit ?? '').toLowerCase()
      const factor = SCALABLE_UNITS.has(unit) ? qty / 100 : 0
      const qtyLabel = qty ? `${qty}${row.ingredient_unit ?? ''}` : ''
      title = qtyLabel ? `${row.ingredient.name} · ${qtyLabel}` : row.ingredient.name
      calories  = (row.ingredient.calories  ?? 0) * factor
      protein_g = (row.ingredient.protein_g ?? 0) * factor
      carbs_g   = (row.ingredient.carbs_g   ?? 0) * factor
      fat_g     = (row.ingredient.fat_g     ?? 0) * factor
      fiber_g   = (row.ingredient.fiber_g   ?? 0) * factor
      sugar_g   = (row.ingredient.sugar_g   ?? 0) * factor
    }

    return {
      id: row.id,
      meal_slot: row.meal_slot,
      title,
      servings,
      calories:  Math.round(calories),
      protein_g: Math.round(protein_g),
      carbs_g:   Math.round(carbs_g),
      fat_g:     Math.round(fat_g),
      fiber_g:   Math.round(fiber_g),
      sugar_g:   Math.round(sugar_g),
      source:    'plan' as const,
      planEntry: {
        id: row.id, date, meal_slot: row.meal_slot,
        recipe_id: row.recipe_id, custom_title: row.custom_title,
        library_ingredient_id: row.library_ingredient_id,
        ingredient_quantity: row.ingredient_quantity, ingredient_unit: row.ingredient_unit,
        servings,
      } as MealPlanEntry,
    }
  })

  const logMeals: DayMeal[] = logRows.map(row => {
    const base = row.ingredient?.name ?? row.recipe?.title ?? row.custom_title ?? '—'
    const qtyLabel = row.quantity ? ` · ${row.quantity}${row.unit === 'serving' ? '×' : (row.unit ?? 'g')}` : ''
    return {
      id: row.id,
      meal_slot: row.meal_slot,
      title: `${base}${qtyLabel}`,
      servings: 1,
      calories:  Math.round(row.calories  ?? 0),
      protein_g: Math.round(row.protein_g ?? 0),
      carbs_g:   Math.round(row.carbs_g   ?? 0),
      fat_g:     Math.round(row.fat_g     ?? 0),
      fiber_g:   Math.round(row.fiber_g   ?? 0),
      sugar_g:   Math.round(row.sugar_g   ?? 0),
      source:    'log' as const,
      logEntry: {
        library_ingredient_id: row.library_ingredient_id,
        recipe_id:             row.recipe_id,
        custom_title:          row.custom_title,
        quantity:              row.quantity,
        unit:                  row.unit,
      },
    }
  })

  return [...meals, ...logMeals]
}
