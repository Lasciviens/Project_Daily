import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addMissingIngredientsToShop } from '../api/shopIntegration'
import type { RecipeIngredient } from '../types'

export function useAddMissingIngredientsToShop() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ ingredients, recipeTitle }: { ingredients: RecipeIngredient[]; recipeTitle: string }) =>
      addMissingIngredientsToShop(ingredients, recipeTitle),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shop'] }),
  })
}
