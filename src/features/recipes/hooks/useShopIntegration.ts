import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { addMissingIngredientsToShop, weekGroceryInputs } from '../api/shopIntegration'
import { useAddBatchToQuickList } from '../../shop/hooks/useQuickBatch'
import type { GroceryLine } from '../weekGroceries'
import type { RecipeIngredient } from '../types'

export function useAddMissingIngredientsToShop() {
  return useMutationWithFeedback({
    action:         'add_missing_ingredients_to_shop',
    loadingMessage: 'Adding to Shop…',
    successMessage: (count: number) => `Added ${count} item${count !== 1 ? 's' : ''} to Shop`,
    mutationFn: ({ ingredients, recipeTitle }: { ingredients: RecipeIngredient[]; recipeTitle: string }) =>
      addMissingIngredientsToShop(ingredients, recipeTitle),
    invalidates: [qk.shop.all],
  })
}

/**
 * The week's groceries in one tap: every planned meal's ingredients added up
 * (`weekGroceries`), what is already on the quick list left out, one Undo.
 */
export function useAddWeekGroceriesToShop() {
  const add = useAddBatchToQuickList()
  return useMutationWithFeedback({
    action:     'add_week_groceries_to_shop',
    silent:     'the batch add reports it, with Undo',
    mutationFn: async ({ lines, what }: { lines: GroceryLine[]; what: string }) => {
      const inputs = await weekGroceryInputs(lines)
      return add.mutateAsync({ inputs, what })
    },
  })
}
