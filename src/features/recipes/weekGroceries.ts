import { fold } from '../shop/shopModel'
import type { MealPlanEntry, RecipeWithIngredients } from './types'

// The week's groceries: the ingredients of every planned meal of a week, added
// up by ingredient and unit. Pure, so scripts/verify-week-groceries.cjs checks
// it. Plain code, no AI: a recipe's ingredient scales by servings planned ÷
// the recipe's own servings (the same factor "Add missing to Shop" uses for
// one recipe); a planned library food is its own line; a one-off line
// ("Restaurant") has no ingredients and adds nothing.

export interface GroceryLine {
  /** Merge key: the folded name and the unit's canonical spelling. */
  key:      string
  name:     string
  /** Sum of the known amounts; null when no meal gave one. */
  quantity: number | null
  unit:     string | null
  /** Some meals named the ingredient without an amount ("salt"): the sum is a floor. */
  partial:  boolean
  /** Titles of the meals that need it, each once, in plan order. */
  for:      string[]
}

type PlanSource = Pick<MealPlanEntry, 'recipe_id' | 'servings' | 'ingredient_quantity' | 'ingredient_unit' | 'ingredient' | 'recipe'>
type RecipeSource = Pick<RecipeWithIngredients, 'id' | 'title' | 'servings' | 'ingredients'>

const UNIT_ALIASES: Record<string, string> = {
  gram: 'g', grams: 'g', gr: 'g',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  kilogram: 'kg', kilograms: 'kg',
  piece: 'pcs', pieces: 'pcs', pc: 'pcs',
}

/** "Grams " → "g"; empty → null. Units that differ after this are different lines. */
export function unitKey(unit: string | null | undefined): string | null {
  const u = (unit ?? '').trim().toLowerCase()
  if (!u) return null
  return UNIT_ALIASES[u] ?? u
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The week's ingredients, merged; lines in the order they first appear. */
export function weekGroceries(plan: readonly PlanSource[], recipes: readonly RecipeSource[]): GroceryLine[] {
  const byId = new Map(recipes.map(r => [r.id, r]))
  const lines = new Map<string, GroceryLine>()

  const put = (name: string, quantity: number | null, unit: string | null, meal: string) => {
    const label = name.trim()
    const folded = fold(label)
    if (!folded) return
    const u = unitKey(unit)
    const key = `${folded}|${u ?? ''}`
    const line = lines.get(key) ?? { key, name: label, quantity: null, unit: u, partial: false, for: [] }
    if (quantity != null && Number.isFinite(quantity) && quantity > 0) line.quantity = round2((line.quantity ?? 0) + quantity)
    else line.partial = true
    if (!line.for.includes(meal)) line.for.push(meal)
    lines.set(key, line)
  }

  for (const p of plan) {
    if (p.recipe_id) {
      const r = byId.get(p.recipe_id)
      if (!r) continue
      const factor = r.servings > 0 ? (p.servings || 1) / r.servings : 1
      for (const i of r.ingredients) put(i.name, i.quantity == null ? null : i.quantity * factor, i.unit, r.title)
    } else if (p.ingredient?.name) {
      put(p.ingredient.name, p.ingredient_quantity, p.ingredient_unit ?? 'g', 'the plan')
    }
  }
  // A line with any amount drops "partial" only when every meal gave one.
  for (const l of lines.values()) if (l.quantity == null) l.partial = false
  return [...lines.values()]
}

/** "400g", "2", "400g + some", "" — the amount as a shopping note. */
export function quantityText(l: Pick<GroceryLine, 'quantity' | 'unit' | 'partial'>): string {
  if (l.quantity == null) return ''
  return `${l.quantity}${l.unit ?? ''}${l.partial ? ' + some' : ''}`
}

/** A line's note: "400g · for Pasta, Soup". */
export function noteOf(l: GroceryLine): string {
  return [quantityText(l), `for ${l.for.join(', ')}`].filter(Boolean).join(' · ')
}
