// A dish in the diary: the rows sharing a meal_group_id (087), shown as one
// line (owner, 16.10.2026, Food point 5). Its name is the owner's own
// (meal_group_title, 158) or worked out from its items ("Rice + Chicken" —
// item names without their amounts); its amount is the summed grams, or
// "3 items" when a piece count is inside. Pure (scripts/verify-food-library.cjs).
import { amountUnit, type LogItem, type MacroSum } from './foodBasket'
import { gramsPerUnit } from './foodUnits'
import type { IngredientLibraryItem, RecipeWithIngredients } from './types'

/** A food's name for a dish title: "White rice, boiled (ris, kokt)" → "White rice". */
export function shortFoodName(name: string): string {
  const cut = name.split(/,|\s\(/)[0]?.trim()
  return cut || name.trim()
}

/** The automatic name: up to three item names joined with " + ", then "+N". */
export function dishAutoName(names: readonly string[]): string {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const n of names) {
    const s = shortFoodName(n)
    const k = s.toLowerCase()
    if (!s || seen.has(k)) continue
    seen.add(k)
    parts.push(s)
  }
  if (parts.length === 0) return 'Meal'
  const head = parts.slice(0, 3).join(' + ')
  return parts.length > 3 ? `${head} +${parts.length - 3}` : head
}

/** The dish's name: its own, else the automatic one. */
export const dishName = (own: string | null | undefined, names: readonly string[]): string => own?.trim() || dishAutoName(names)

/** What a diary row's amount is: grams, ml, or a count of servings / pieces. */
export interface AmountRow { quantity: number | null; unit: string | null }

/** "250 g" when every item is weighed in grams ("330 ml" in ml), else "3 items". */
export function dishAmount(rows: readonly AmountRow[]): string {
  let sum = 0
  let unit: 'g' | 'ml' | null = null
  for (const r of rows) {
    const k = r.unit ? gramsPerUnit(r.unit) : null
    const u = r.unit?.trim().toLowerCase() === 'ml' ? 'ml' : 'g'
    if (r.quantity == null || !(r.quantity > 0) || k == null || (unit && unit !== u)) return `${rows.length} items`
    unit = u
    sum += r.quantity * k
  }
  return unit ? `${Math.round(sum)} ${unit}` : `${rows.length} items`
}

/** A logged diary row, as the logger's basket holds it (Edit meal, Save as saved meal). */
export interface DiaryRowLike extends AmountRow {
  id: string
  title: string
  library_ingredient_id: string | null
  recipe_id: string | null
  calories: number | null; protein_g: number | null; carbs_g: number | null
  fat_g: number | null; fiber_g: number | null; sugar_g: number | null
}

/**
 * A row as a basket item: a weighed library food, a recipe by servings, else
 * the line as it is (a one-off line, a food in pieces, a source that is gone).
 */
export function rowToItem(
  row: DiaryRowLike,
  library: ReadonlyMap<string, IngredientLibraryItem>,
  recipes: ReadonlyMap<string, RecipeWithIngredients>,
): LogItem {
  const lib = row.library_ingredient_id ? library.get(row.library_ingredient_id) : undefined
  if (lib && row.quantity != null && row.quantity > 0 && gramsPerUnit(row.unit ?? 'g') === 1 && amountUnit(row.unit) === amountUnit(lib.unit)) {
    return { ingredient: lib, grams: row.quantity, entryId: row.id }
  }
  const rec = row.recipe_id ? recipes.get(row.recipe_id) : undefined
  if (rec && row.quantity != null && row.quantity > 0) return { kind: 'recipe', recipe: rec, servings: row.quantity, entryId: row.id }
  const macros: MacroSum = {
    kcal: row.calories ?? 0, protein: row.protein_g ?? 0, carbs: row.carbs_g ?? 0,
    fat: row.fat_g ?? 0, fiber: row.fiber_g ?? 0, sugar: row.sugar_g ?? 0,
  }
  return { kind: 'custom', title: row.title, macros, entryId: row.id }
}
