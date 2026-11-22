import { missingIngredientInputs, weekGroceryInputs } from '../api/shopIntegration'
import { useAddBatchToQuickList } from '../../shop/hooks/useQuickBatch'
import type { GroceryLine } from '../weekGroceries'
import type { RecipeIngredient } from '../types'

// Both buttons are Shop's one batch add (duplicates skipped, one Undo, one
// error toast); the category lookup is its `prepare` step.

/** "Add missing to Shop" on one recipe. */
export function useAddMissingIngredientsToShop() {
  const add = useAddBatchToQuickList()
  return {
    mutate: ({ ingredients, recipeTitle }: { ingredients: RecipeIngredient[]; recipeTitle: string }) =>
      add.mutate({ prepare: () => missingIngredientInputs(ingredients, recipeTitle), what: recipeTitle }),
    isPending: add.isPending,
  }
}

/** The week's groceries in one tap: the planned meals' ingredients added up (`weekGroceries`). */
export function useAddWeekGroceriesToShop() {
  const add = useAddBatchToQuickList()
  return {
    mutate: ({ lines, what }: { lines: GroceryLine[]; what: string }) =>
      add.mutate({ prepare: () => weekGroceryInputs(lines), what }),
    isPending: add.isPending,
  }
}
