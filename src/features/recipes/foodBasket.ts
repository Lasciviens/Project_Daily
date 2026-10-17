// The basket shared by the food logger (FoodLogModal) and the Library's quick
// recipe builder (RecipeBuilder): foods by weight, their live totals, and the
// recipe ingredient rows a basket saves as. The logger's basket also holds a
// saved meal's portion ("Køfte · 3 pieces", 8.4) and, when a dish is edited,
// its one-off lines as they are; the builder holds foods only (no recipe
// inside a recipe). Pure (scripts/verify-food-library.cjs).
import { gramsPerUnit } from './foodUnits'
import { countLabel, portionWord } from './foodAmount'
import type { FoodLogEntryInput, IngredientDraft, IngredientLibraryItem, MealSlot, Recipe, RecipeInput, RecipeWithIngredients } from './types'

/** A food by weight. `entryId`: the diary row it came from (editing a dish). */
export interface BasketItem { ingredient: IngredientLibraryItem; grams: number; entryId?: string }
/** A saved meal's portion: servings of the recipe. */
export interface RecipeBasketItem { kind: 'recipe'; recipe: RecipeWithIngredients; servings: number; entryId?: string }
/** A one-off line already in a dish (kept as it is; it can only be taken out). */
export interface CustomBasketItem { kind: 'custom'; title: string; macros: MacroSum; entryId: string }
export type LogItem = BasketItem | RecipeBasketItem | CustomBasketItem

export const isRecipeItem = (it: LogItem): it is RecipeBasketItem => 'kind' in it && it.kind === 'recipe'
export const isCustomItem = (it: LogItem): it is CustomBasketItem => 'kind' in it && it.kind === 'custom'
export const isFoodItem = (it: LogItem): it is BasketItem => !('kind' in it)

/** A basket amount is grams, or ml for a drink stored per 100 ml. */
export const amountUnit = (u: string | null | undefined): 'g' | 'ml' => (u?.trim().toLowerCase() === 'ml' ? 'ml' : 'g')

export interface MacroSum { kcal: number; protein: number; carbs: number; fat: number; fiber: number; sugar: number }

const ZERO: MacroSum = { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }

// Snapshot builders — per-100g × grams for ingredients, per-serving ×
// servings for recipes (the rounding migration 106's triggers use).
const per = (v: number | null | undefined, grams: number) => (v == null ? null : Math.round(v * grams) / 100)

export function ingredientSnapshot(ing: Pick<IngredientLibraryItem, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g'>, grams: number) {
  return {
    calories:  per(ing.calories, grams),
    protein_g: per(ing.protein_g, grams),
    carbs_g:   per(ing.carbs_g, grams),
    fat_g:     per(ing.fat_g, grams),
    fiber_g:   per(ing.fiber_g, grams),
    sugar_g:   per(ing.sugar_g, grams),
  }
}

export function recipeSnapshot(recipe: Pick<Recipe, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'sugar_g'>, servings: number) {
  const times = (v: number | null | undefined) => (v == null ? null : Math.round(v * servings * 10) / 10)
  return {
    calories:  times(recipe.calories),
    protein_g: times(recipe.protein_g),
    carbs_g:   times(recipe.carbs_g),
    fat_g:     times(recipe.fat_g),
    fiber_g:   times(recipe.fiber_g),
    sugar_g:   times(recipe.sugar_g),
  }
}

/** One item's macros (unrounded). */
export function itemMacros(it: LogItem): MacroSum {
  if (isCustomItem(it)) return it.macros
  if (isRecipeItem(it)) {
    const r = it.recipe, k = it.servings > 0 ? it.servings : 0
    return {
      kcal: (r.calories ?? 0) * k, protein: (r.protein_g ?? 0) * k, carbs: (r.carbs_g ?? 0) * k,
      fat: (r.fat_g ?? 0) * k, fiber: (r.fiber_g ?? 0) * k, sugar: (r.sugar_g ?? 0) * k,
    }
  }
  const f = it.ingredient, k = it.grams > 0 ? it.grams / 100 : 0
  return {
    kcal: (f.calories ?? 0) * k, protein: (f.protein_g ?? 0) * k, carbs: (f.carbs_g ?? 0) * k,
    fat: (f.fat_g ?? 0) * k, fiber: (f.fiber_g ?? 0) * k, sugar: (f.sugar_g ?? 0) * k,
  }
}

/** Per-100 g macros × grams (a portion × servings, a one-off line as it is), summed over the basket (unrounded). */
export function basketTotals(items: readonly LogItem[]): MacroSum {
  return items.reduce((t, it) => {
    const m = itemMacros(it)
    return { kcal: t.kcal + m.kcal, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat, fiber: t.fiber + m.fiber, sugar: t.sugar + m.sugar }
  }, ZERO)
}

/** The item's name: the food, the saved meal, the one-off line. */
export function itemTitle(it: LogItem): string {
  if (isCustomItem(it)) return it.title
  if (isRecipeItem(it)) return it.recipe.title
  return it.ingredient.name
}

/** "150 g", "3 pieces", or '' for a one-off line. */
export function itemAmount(it: LogItem): string {
  if (isCustomItem(it)) return ''
  if (isRecipeItem(it)) return countLabel(it.servings, portionWord(it.recipe.serving_label))
  return `${Math.round(it.grams)} ${amountUnit(it.ingredient.unit)}`
}

/** An amount still to be typed (0 g / 0 pieces). */
export const itemMissingAmount = (it: LogItem): boolean =>
  isCustomItem(it) ? false : isRecipeItem(it) ? !(it.servings > 0) : !(it.grams > 0)

/** The diary rows a basket logs as (a food by weight, a recipe by servings); one-off lines are already rows. */
export function itemsToEntries(
  items: readonly LogItem[],
  at: { date: string; slot: MealSlot; groupId?: string | null; groupTitle?: string | null },
): FoodLogEntryInput[] {
  const group = at.groupId ? { meal_group_id: at.groupId, ...(at.groupTitle ? { meal_group_title: at.groupTitle } : {}) } : { meal_group_id: null }
  return items.filter(it => !isCustomItem(it)).map(it => isRecipeItem(it)
    ? { date: at.date, meal_slot: at.slot, recipe_id: it.recipe.id, quantity: it.servings, unit: 'serving', ...recipeSnapshot(it.recipe, it.servings), ...group }
    : { date: at.date, meal_slot: at.slot, library_ingredient_id: (it as BasketItem).ingredient.id, quantity: (it as BasketItem).grams,
        unit: amountUnit((it as BasketItem).ingredient.unit), ...ingredientSnapshot((it as BasketItem).ingredient, (it as BasketItem).grams), ...group })
}

/** recipes.servings is a whole number (an integer column — "2.5" failed to save). */
export const wholePortions = (raw: string | number): number => Math.max(1, Math.round(Number(raw) || 1))

/** One portion of a batch, rounded to 0.1 like the saved per-serving macros. */
export function perPortion(t: MacroSum, portions: number): MacroSum {
  const n = Math.max(1, portions)
  const r = (v: number) => Math.round((v / n) * 10) / 10
  return { kcal: r(t.kcal), protein: r(t.protein), carbs: r(t.carbs), fat: r(t.fat), fiber: r(t.fiber), sugar: r(t.sugar) }
}

/** The recipe ingredient rows a basket saves as: every row library-linked by weight, so the macros follow the foods. */
export function basketToIngredients(items: readonly BasketItem[]): IngredientDraft[] {
  return items.map(it => ({
    name: it.ingredient.name, quantity: it.grams, unit: amountUnit(it.ingredient.unit), note: null, library_ingredient_id: it.ingredient.id,
  }))
}

const isWeighedLink = (r: IngredientDraft) => !!r.library_ingredient_id && r.quantity != null && r.quantity > 0 && gramsPerUnit(r.unit ?? '') != null

/**
 * A basket (or a dish) saved as a saved meal of `portions`. Foods stay foods;
 * a saved meal's portion becomes its own ingredients for that share (no recipe
 * inside a recipe). When every row is a weighed food the macros follow them
 * ('from_ingredients'); a one-off line or an unlinked ingredient makes it a
 * typed-macro meal with the basket's own totals per portion.
 */
export function basketToRecipeInput(items: readonly LogItem[], title: string, portions: number, extra: Partial<RecipeInput> = {}): RecipeInput {
  const rows: IngredientDraft[] = []
  for (const it of items) {
    if (isCustomItem(it)) { rows.push({ name: it.title, quantity: null, unit: null, note: `${Math.round(it.macros.kcal)} kcal`, library_ingredient_id: null }); continue }
    if (isRecipeItem(it)) {
      const share = it.servings / Math.max(1, it.recipe.servings)
      for (const i of it.recipe.ingredients) {
        rows.push({ name: i.name, quantity: i.quantity == null ? null : Math.round(i.quantity * share * 10) / 10, unit: i.unit, note: i.note, library_ingredient_id: i.library_ingredient_id })
      }
      if (it.recipe.ingredients.length === 0) rows.push({ name: it.recipe.title, quantity: null, unit: null, note: countLabel(it.servings, portionWord(it.recipe.serving_label)), library_ingredient_id: null })
      continue
    }
    rows.push(...basketToIngredients([it]))
  }
  const n = wholePortions(portions)
  const followsFoods = rows.length > 0 && rows.every(isWeighedLink)
  const each = perPortion(basketTotals(items), n)
  return {
    title: title.trim(), servings: n, ingredients: rows,
    ...(followsFoods
      ? { macro_mode: 'from_ingredients' as const }
      : { macro_mode: 'manual' as const, calories: each.kcal, protein_g: each.protein, carbs_g: each.carbs, fat_g: each.fat, fiber_g: each.fiber, sugar_g: each.sugar }),
    ...extra,
  }
}

/** Whole portions of the food's preset in this amount (for − / +), or null when it has no preset. */
export function portionSteps(item: BasketItem): { size: number; count: number; label: string } | null {
  const size = item.ingredient.serving_grams
  const label = item.ingredient.serving_label
  if (!label || size == null || size <= 0) return null
  return { size, count: Math.max(1, Math.round(item.grams / size)), label: label.replace(/^1\s*/, '') }
}

/** The amount a recent food was last eaten in, as basket grams — none for a count ("2 pcs"). */
export function lastGrams(r: { quantity: number | null; unit: string | null }): number | undefined {
  return r.quantity != null && r.quantity > 0 && gramsPerUnit(r.unit ?? 'g') === 1 ? r.quantity : undefined
}
