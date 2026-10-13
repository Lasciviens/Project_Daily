import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { fetchRecipes, createRecipe, updateRecipe, incrementTimesCooked } from '../api/recipesApi'
import { refreshEatenEntries } from '../api/foodLogApi'
import type { RecipeInput, RecipeWithIngredients } from '../types'

export function useRecipes() {
  return useQuery({
    queryKey:  qk.recipes.all,
    queryFn:   fetchRecipes,
    staleTime: STALE.short,
  })
}

/**
 * One recipe by id — a projection of the recipe list (same cache entry), so a
 * popup reads the live row instead of one a list handed over.
 */
export function useRecipe(id: string | null | undefined) {
  return useQuery({
    queryKey:  qk.recipes.all,
    queryFn:   fetchRecipes,
    staleTime: STALE.short,
    enabled:   !!id,
    select:    (list: RecipeWithIngredients[]) => list.find(r => r.id === id) ?? null,
  })
}

export function useCreateRecipe() {
  return useMutationWithFeedback({
    action:     'create_recipe',
    successMessage: (_: string, input: RecipeInput) => input.is_temp
      ? `Saved "${input.title}" — log it anytime from Saved meals`
      : `Saved "${input.title}"`,
    mutationFn: (input: RecipeInput) => createRecipe(input),
    invalidates: ['recipes'],
  })
}

export function useUpdateRecipe() {
  return useMutationWithFeedback({
    action:     'update_recipe',
    successMessage: 'Recipe saved',
    // Eaten rows of this recipe follow its new totals (past days included).
    mutationFn: async ({ id, input }: { id: string; input: RecipeInput }) => {
      await updateRecipe(id, input)
      await refreshEatenEntries({ recipeIds: [id] })
    },
    invalidates: ['recipes', 'nutrition'],
  })
}

/**
 * Deletes a recipe or saved meal with Undo: its ingredient lines and
 * favourite go with it, days you ate it keep their totals (rule 107); Undo
 * puts it all back and re-links those days.
 */
export function useDeleteRecipe() {
  return useRowsDelete({ table: 'recipes', action: 'delete_recipe', invalidates: ['recipes', 'nutrition', qk.foodLog.all], cache: qk.recipes.all })
}

export function useIncrementTimesCooked() {
  return useMutationWithFeedback({
    action:         'increment_times_cooked',
    successMessage: (_: void, { current }: { id: string; current: number }) =>
      current === 0 ? 'First time — nice' : `Made it ${current + 1} times`,
    mutationFn:     ({ id, current }: { id: string; current: number }) => incrementTimesCooked(id, current),
    invalidates:    ['recipes'],
  })
}
