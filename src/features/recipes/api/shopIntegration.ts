// Recipes → Shop bridge: builds the rows that put ingredients you don't already
// have onto the Shop's quick list (the errand list — migration 134), still
// filed under Groceries → Recipe Ingredients. Crosses the feature boundary
// deliberately — this is the one place Recipes talks to Shop's API directly.
// Writing is Shop's: `useAddBatchToQuickList` (duplicates skipped, one Undo).
import { fetchShopCategories, createShopCategory } from '../../shop/api/shopApi'
import type { CreateShopItemInput } from '../../shop/types'
import type { RecipeIngredient } from '../types'
import { noteOf, type GroceryLine } from '../weekGroceries'

const TOP_CATEGORY = 'Groceries'
const SUB_CATEGORY = 'Recipe Ingredients'

/** The Groceries → Recipe Ingredients category (made when missing; the batch hook refreshes the category list). */
export async function resolveTargetCategory(): Promise<string> {
  const categories = await fetchShopCategories()
  let top = categories.find(c => !c.parent_id && c.name === TOP_CATEGORY)
  if (!top) top = await createShopCategory({ name: TOP_CATEGORY })

  let sub = categories.find(c => c.parent_id === top!.id && c.name === SUB_CATEGORY)
  if (!sub) sub = await createShopCategory({ name: SUB_CATEGORY, parent_id: top.id })
  return sub.id
}

/** One recipe's missing ingredients as quick-list rows ("400g · for Pasta"). */
export async function missingIngredientInputs(ingredients: RecipeIngredient[], recipeTitle: string): Promise<CreateShopItemInput[]> {
  if (!ingredients.length) return []
  const categoryId = await resolveTargetCategory()
  return ingredients.map(ing => {
    const qty = ing.quantity != null ? `${ing.quantity}${ing.unit ?? ''}` : null
    return {
      category_id: categoryId, title: ing.name, notes: [qty, `for ${recipeTitle}`].filter(Boolean).join(' · '),
      source_type: 'manual', list: 'quick',
    }
  })
}

/** The week's grocery lines as quick-list rows, filed the same way. */
export async function weekGroceryInputs(lines: GroceryLine[]): Promise<CreateShopItemInput[]> {
  if (!lines.length) return []
  const categoryId = await resolveTargetCategory()
  return lines.map(l => ({ category_id: categoryId, title: l.name, notes: noteOf(l), source_type: 'manual', list: 'quick' }))
}
