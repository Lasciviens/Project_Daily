// Recipes → Shop bridge: pushes ingredients you don't already have onto the
// shopping wishlist. Crosses the feature boundary deliberately — this is the
// one place Recipes talks to Shop's API directly.
import { fetchShopCategories, createShopCategory, createShopItem } from '../../shop/api/shopApi'
import type { RecipeIngredient } from '../types'

const TOP_CATEGORY = 'Groceries'
const SUB_CATEGORY = 'Recipe Ingredients'

async function resolveTargetCategory(): Promise<string> {
  const categories = await fetchShopCategories()
  let top = categories.find(c => !c.parent_id && c.name === TOP_CATEGORY)
  if (!top) top = await createShopCategory({ name: TOP_CATEGORY })

  let sub = categories.find(c => c.parent_id === top!.id && c.name === SUB_CATEGORY)
  if (!sub) sub = await createShopCategory({ name: SUB_CATEGORY, parent_id: top.id })
  return sub.id
}

export async function addMissingIngredientsToShop(
  ingredients: RecipeIngredient[],
  recipeTitle: string,
): Promise<number> {
  if (!ingredients.length) return 0
  const categoryId = await resolveTargetCategory()

  for (const ing of ingredients) {
    const qty = ing.quantity != null ? `${ing.quantity}${ing.unit ?? ''}` : null
    await createShopItem({
      category_id: categoryId,
      title:       ing.name,
      notes:       [qty, `for ${recipeTitle}`].filter(Boolean).join(' · '),
      source_type: 'manual',
    })
  }
  return ingredients.length
}
