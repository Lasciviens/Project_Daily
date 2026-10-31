import { supabase } from '../../../integrations/supabase/client'
import { toGrams } from '../../recipes/foodUnits'
import type { MealPlanEntry } from '../../recipes/types'
import { eatenTotals, macroAmounts, type MacroAmounts } from '../../recipes/foodIngredients'
import { groupDishes, type DishGroup, type DishSingle } from '../../recipes/foodDish'
import { countLabel } from '../../recipes/foodAmount'
import { COUNT_UNITS } from '../../supplements/supplementDoses'
import { eatenTimeLabel } from '../../recipes/components/foodLogUtils'

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
  /** The same six unrounded (the figures above are whole numbers) — what the
      Today peek's exact amounts add up. */
  exact?:    MacroAmounts
  /** 'plan' = a status='planned' row (intent, macros computed live); 'log' = a
      status='eaten' row (what was actually eaten; totals derived from its
      source, migration 106). Both live in food_log_entries since migration 061. */
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
    /** A scheduled supplement's dose (160): its values are the schedule's, never a guess. */
    supplement_schedule_id?: string | null
  }
  /** Ties several individually-logged rows together as one compact diary
      line ("As meal" in FoodLogModal) — null for a normal single-item or
      recipe log, and always null for a plan row (grouping only applies to
      what was actually eaten). Migration 087. */
  meal_group_id?: string | null
  /** The dish's own name (158), the same on every row of the group; null = automatic. */
  meal_group_title?: string | null
  /** When it was eaten, HH:MM (181, eaten rows); null for a planned row or a log from before 181. */
  eaten_time?: string | null
}

// A meal-slot's rows, collapsed so several entries sharing the same
// `meal_group_id` render as ONE compact row (a dish) instead of N separate
// lines — the display half of the "As meal" feature. The pure rule
// (order-preserving; a "group" of one is a plain row; the dish's name and
// amount) is foodDish.groupDishes (scripts/verify-food-library.cjs).
export type MealGroupRow = DishGroup<DayMeal>
export type SingleMealRow = DishSingle<DayMeal>
export type MealDisplayRow = MealGroupRow | SingleMealRow

export const groupDayMeals = (meals: readonly DayMeal[]): MealDisplayRow[] => groupDishes(meals)

/** The eaten rows of one meal another line can join as a dish ("In" in Edit entry) — never a taken supplement dose's line, which keeps its day and meal (160). */
export const joinableMeals = (meals: readonly DayMeal[], slot: DayMeal['meal_slot']): DayMeal[] =>
  meals.filter(m => m.source === 'log' && m.meal_slot === slot && !m.logEntry?.supplement_schedule_id)

export interface DayNutrition {
  meals:     DayMeal[]
  calories:  number
  protein_g: number
  carbs_g:   number
  fat_g:     number
  fiber_g:   number
  sugar_g:   number
}

// A planned food counts per 100 g only in a unit foodUnits can weigh (g, kg,
// ml, dl, l…) — the same gate as Meal plan's plannedKcal and ticking it eaten
// (a g/ml-only gate here showed "0.5 kg" as 0 kcal); a "piece"/"clove"
// quantity can't be converted, so it's skipped.
const per100 = (quantity: number | null, unit: string | null): number => {
  const grams = toGrams(quantity, unit ?? 'g')
  return grams != null ? grams / 100 : 0
}

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

// migration 087 (meal_group_id) may not be applied yet — retry without the
// column rather than erroring the whole nutrition card; every row then reads
// as its own ungrouped `SingleMealRow`, exactly today's behaviour.
function isMissingMealGroup(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /meal_group_id/i.test(x?.message ?? '')
}

// 157 (a recipe's portion name), 158 (a dish's own name) and 160 (a dose's
// schedule) ship together.
function isMissingGroupTitle(e: unknown): boolean {
  const x = e as { code?: string; message?: string }
  return (x?.code === '42703' || x?.code === 'PGRST204') && /meal_group_title|serving_label|supplement_schedule_id/i.test(x?.message ?? '')
}

/**
 * An eaten line's amount after its name: " · 150g", " · 2×", " · 3 pieces"
 * (a recipe with its own portion name, 157), " · 2 capsules" (a supplement's
 * count unit, 160 — glued, it read "2capsule").
 */
function eatenQtyLabel(quantity: number | null, unit: string | null, servingLabel?: string | null): string {
  if (!quantity) return ''
  if (unit === 'serving') return servingLabel?.trim() ? ` · ${countLabel(quantity, servingLabel.trim())}` : ` · ${quantity}×`
  if (unit && (COUNT_UNITS as readonly string[]).includes(unit)) return ` · ${countLabel(quantity, unit)}`
  return ` · ${quantity} ${unit ?? 'g'}`
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
  meal_group_id?: string | null
  meal_group_title?: string | null
  supplement_schedule_id?: string | null
  eaten_time?: string | null
  recipe:     { title: string; serving_label?: string | null; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; sugar_g: number | null } | null
  ingredient: { name: string; unit: string; calories: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; fiber_g: number | null; sugar_g: number | null } | null
}

const UNIFIED_COLS =
  'id, meal_slot, status, recipe_id, library_ingredient_id, custom_title, quantity, unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, '
const INGREDIENT_EMBED = 'ingredient:recipe_ingredient_library(name, unit, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g)'
const UNIFIED_SELECT_BASE = `${UNIFIED_COLS}recipe:recipes(title, calories, protein_g, carbs_g, fat_g, sugar_g), ${INGREDIENT_EMBED}`
const UNIFIED_SELECT_087 = `${UNIFIED_SELECT_BASE}, meal_group_id`
const UNIFIED_SELECT =
  `${UNIFIED_COLS}recipe:recipes(title, serving_label, calories, protein_g, carbs_g, fat_g, sugar_g), ${INGREDIENT_EMBED}, meal_group_id, meal_group_title, supplement_schedule_id`
/** 181's time of an eaten row on top. */
const UNIFIED_SELECT_181 = `${UNIFIED_SELECT}, eaten_time`
const isMissingEatenTime = (e: unknown) => {
  const x = e as { code?: string; message?: string } | null
  return (x?.code === '42703' || x?.code === 'PGRST204') && /eaten_time/i.test(x?.message ?? '')
}

// Exported for unit-testability (the post-061 path can't be exercised against
// an un-migrated DB) — a pure row→DayMeal mapper.
export function unifiedToMeal(row: UnifiedRow, date: string): DayMeal {
  if (row.status === 'planned') {
    // Intent → macros computed LIVE (recipe per-serving × servings, or library
    // per-100g × grams/100 for a weight unit). A one-off line keeps what was
    // typed (planning "kebab 700 kcal" in the logger's plan mode, 26.10.2026).
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
      const factor = per100(row.quantity, row.unit)
      const qtyLabel = qty ? `${qty}${row.unit ? ` ${row.unit}` : ''}` : ''
      title = qtyLabel ? `${row.ingredient.name} · ${qtyLabel}` : row.ingredient.name
      calories = (row.ingredient.calories ?? 0) * factor; protein_g = (row.ingredient.protein_g ?? 0) * factor
      carbs_g = (row.ingredient.carbs_g ?? 0) * factor; fat_g = (row.ingredient.fat_g ?? 0) * factor
      fiber_g = (row.ingredient.fiber_g ?? 0) * factor; sugar_g = (row.ingredient.sugar_g ?? 0) * factor
    } else {
      calories = row.calories ?? 0; protein_g = row.protein_g ?? 0; carbs_g = row.carbs_g ?? 0
      fat_g = row.fat_g ?? 0; fiber_g = row.fiber_g ?? 0; sugar_g = row.sugar_g ?? 0
    }
    return {
      id: row.id, meal_slot: row.meal_slot, title, servings,
      calories: Math.round(calories), protein_g: Math.round(protein_g), carbs_g: Math.round(carbs_g),
      fat_g: Math.round(fat_g), fiber_g: Math.round(fiber_g), sugar_g: Math.round(sugar_g),
      exact: { calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g },
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
  const qtyLabel = eatenQtyLabel(row.quantity, row.unit, row.recipe?.serving_label)
  return {
    id: row.id, meal_slot: row.meal_slot, title: `${base}${qtyLabel}`, servings: 1,
    calories: Math.round(row.calories ?? 0), protein_g: Math.round(row.protein_g ?? 0), carbs_g: Math.round(row.carbs_g ?? 0),
    fat_g: Math.round(row.fat_g ?? 0), fiber_g: Math.round(row.fiber_g ?? 0), sugar_g: Math.round(row.sugar_g ?? 0),
    exact: macroAmounts(row),
    source: 'log',
    logEntry: {
      library_ingredient_id: row.library_ingredient_id, recipe_id: row.recipe_id,
      custom_title: row.custom_title, quantity: row.quantity, unit: row.unit,
      supplement_schedule_id: row.supplement_schedule_id ?? null,
    },
    meal_group_id: row.meal_group_id ?? null,
    meal_group_title: row.meal_group_title ?? null,
    eaten_time: eatenTimeLabel(row.eaten_time),
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
  // Typed loosely (not the query builder's own literal-select-inferred type)
  // since the two `select()` calls below use different column lists and are
  // cast to UnifiedRow[] downstream regardless.
  let uni: { data: unknown; error: unknown } =
    await supabase.from('food_log_entries').select(UNIFIED_SELECT_181).eq('date', date).order('created_at', { ascending: true })
  if (uni.error && isMissingEatenTime(uni.error)) {
    // migration 181 not applied yet — no times; the Diary shows each meal at its usual hour, as before.
    uni = await supabase.from('food_log_entries').select(UNIFIED_SELECT).eq('date', date).order('created_at', { ascending: true })
  }
  if (uni.error && isMissingGroupTitle(uni.error)) {
    // migrations 157/158/160 not applied yet — a dish keeps its automatic name, a recipe reads "2×".
    uni = await supabase.from('food_log_entries').select(UNIFIED_SELECT_087).eq('date', date).order('created_at', { ascending: true })
  }
  if (uni.error && isMissingMealGroup(uni.error)) {
    // migration 087 not applied yet — retry without meal_group_id; every
    // row then reads as ungrouped (today's behaviour), never a hard error.
    uni = await supabase.from('food_log_entries').select(UNIFIED_SELECT_BASE).eq('date', date).order('created_at', { ascending: true })
  }
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
  // Exact values summed, rounded once — the same total the figures' peeks show.
  return { meals: allMeals, ...eatenTotals(allMeals) }
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
      const factor = per100(row.ingredient_quantity, row.ingredient_unit)
      const qtyLabel = qty ? `${qty}${row.ingredient_unit ? ` ${row.ingredient_unit}` : ''}` : ''
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
      exact:     { calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g },
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
    const qtyLabel = eatenQtyLabel(row.quantity, row.unit)
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
      exact:     macroAmounts(row),
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
