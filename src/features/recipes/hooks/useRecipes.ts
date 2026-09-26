import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchRecipes, createRecipe, updateRecipe, deleteRecipe, incrementTimesCooked } from '../api/recipesApi'
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
    mutationFn: ({ id, input }: { id: string; input: RecipeInput }) => updateRecipe(id, input),
    invalidates: ['recipes'],
  })
}

export function useDeleteRecipe() {
  return useMutationWithFeedback({
    action:         'delete_recipe',
    successMessage: 'Recipe deleted',
    mutationFn:     (id: string) => deleteRecipe(id),
    invalidates:    ['recipes'],
  })
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
