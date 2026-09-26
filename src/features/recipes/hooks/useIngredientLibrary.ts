import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchIngredientLibrary, createIngredientLibraryItem, updateIngredientLibraryItem, deleteIngredientLibraryItem,
  upsertExternalFood,
} from '../api/ingredientLibraryApi'
import { recomputeRecipesUsingIngredient } from '../api/recipesApi'
import { refreshEatenEntries } from '../api/foodLogApi'
import type { CreateIngredientLibraryItemInput } from '../types'

export function useIngredientLibrary() {
  return useQuery({
    queryKey:  qk.ingredients.all,
    queryFn:   fetchIngredientLibrary,
    staleTime: STALE.default,
  })
}

export function useCreateIngredientLibraryItem() {
  return useMutationWithFeedback({
    action:      'create_ingredient_library_item',
    mutationFn:  (input: CreateIngredientLibraryItemInput) => createIngredientLibraryItem(input),
    invalidates: [qk.ingredients.all],
  })
}

/** A scanned / online-search product: deduped by its source reference. */
export function useUpsertExternalFood() {
  return useMutationWithFeedback({
    action:      'upsert_external_food',
    mutationFn:  (input: CreateIngredientLibraryItemInput) => upsertExternalFood(input),
    invalidates: [qk.ingredients.all],
  })
}

export function useUpdateIngredientLibraryItem() {
  return useMutationWithFeedback({
    action:     'update_ingredient_library_item',
    // Totals are derived: a macro edit recalculates the recipes built from this
    // ingredient and every eaten diary row that uses it or those recipes.
    mutationFn: async ({ id, input }: { id: string; input: CreateIngredientLibraryItemInput }) => {
      const item = await updateIngredientLibraryItem(id, input)
      const recipeIds = await recomputeRecipesUsingIngredient(id)
      await refreshEatenEntries({ libraryId: id, recipeIds })
      return item
    },
    invalidates: ['recipes', 'nutrition', qk.ingredients.all],
  })
}

export function useDeleteIngredientLibraryItem() {
  return useMutationWithFeedback({
    action:      'delete_ingredient_library_item',
    mutationFn:  (id: string) => deleteIngredientLibraryItem(id),
    invalidates: [qk.ingredients.all],
  })
}
