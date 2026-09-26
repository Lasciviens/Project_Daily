import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchIngredientLibrary, createIngredientLibraryItem, updateIngredientLibraryItem, deleteIngredientLibraryItem,
  upsertExternalFood,
} from '../api/ingredientLibraryApi'
import { recomputeRecipesUsingIngredient } from '../api/recipesApi'
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
    // Recipes store computed macros, so a macro edit must recompute the ones
    // built from this ingredient — otherwise their totals never change.
    mutationFn: async ({ id, input }: { id: string; input: CreateIngredientLibraryItemInput }) => {
      const item = await updateIngredientLibraryItem(id, input)
      await recomputeRecipesUsingIngredient(id)
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
