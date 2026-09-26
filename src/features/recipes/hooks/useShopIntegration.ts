import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk } from '../../../shared/query'
import { addMissingIngredientsToShop } from '../api/shopIntegration'
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
