import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import {
  fetchIngredientLibrary, createIngredientLibraryItem, updateIngredientLibraryItem, upsertExternalFood,
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
    successMessage: (item) => `${item.name} added to your foods`,
    mutationFn:  (input: CreateIngredientLibraryItemInput) => createIngredientLibraryItem(input),
    invalidates: [qk.ingredients.all],
  })
}

/** A scanned / online-search product: deduped by its source reference. */
export function useUpsertExternalFood() {
  return useMutationWithFeedback({
    action:      'upsert_external_food',
    successMessage: (item) => `${item.name} is in your foods`,
    mutationFn:  (input: CreateIngredientLibraryItemInput) => upsertExternalFood(input),
    invalidates: [qk.ingredients.all],
  })
}

export function useUpdateIngredientLibraryItem() {
  return useMutationWithFeedback({
    action:     'update_ingredient_library_item',
    successMessage: 'Food saved',
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

/**
 * Deletes a food with Undo. Recipes built from it switch to typed macros and
 * keep their totals, days you ate it keep theirs (rules 107, 123); Undo puts
 * the food back, re-links those recipe lines and diary rows and switches the
 * recipes back (migration 144).
 */
export function useDeleteIngredientLibraryItem() {
  return useRowsDelete({
    table: 'recipe_ingredient_library', action: 'delete_ingredient_library_item',
    invalidates: [qk.ingredients.all, 'recipes', 'nutrition'], cache: qk.ingredients.all,
  })
}
