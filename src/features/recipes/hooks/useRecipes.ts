import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { mapRowsInCache } from '../../../shared/query/cachePatch'
import { fetchRecipes, createRecipe, updateRecipe, incrementTimesCooked, updateRecipeBatch, type RecipeBatchPatch } from '../api/recipesApi'
import { fetchFoodLogRange, refreshEatenEntries } from '../api/foodLogApi'
import { batchState, liveBatchesFrom, type BatchState } from '../foodAmount'
import { localDayOf, shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
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

/** "I made this": counts it and starts a batch of `servings` (migration 157). */
export function useIncrementTimesCooked() {
  return useMutationWithFeedback({
    action:         'increment_times_cooked',
    successMessage: (_: void, { current, servings }: { id: string; current: number; servings?: number }) =>
      `${current === 0 ? 'First time — nice' : `Made it ${current + 1} times`}${servings ? ` · a batch of ${servings}` : ''}`,
    mutationFn:     ({ id, current, servings }: { id: string; current: number; servings?: number }) => incrementTimesCooked(id, current, servings),
    invalidates:    ['recipes'],
  })
}

/** "New batch" and the pot's weight in the portion sheet; the stored batch goes straight into the recipe list. */
export function useUpdateRecipeBatch() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'update_recipe_batch',
    successMessage: (_: unknown, v: { id: string; patch: RecipeBatchPatch; done: string }) => v.done,
    mutationFn:     ({ id, patch }: { id: string; patch: RecipeBatchPatch; done: string }) => updateRecipeBatch(id, patch),
    onSuccess:      row => mapRowsInCache<RecipeWithIngredients>(qc, qk.recipes.all, new Set([row.id]), r => ({ ...r, ...row })),
    invalidates:    ['recipes'],
  })
}

/**
 * Every listed recipe's batch (the logger's Saved meals strip): ONE diary read
 * from the earliest batch still within its 4 days; a batch older than that is
 * over whatever was eaten, so it needs no rows. Recipes that never had a batch
 * are left out. A live batch is missing while its read loads.
 */
export function useRecipeBatches(recipes: readonly RecipeWithIngredients[]): ReadonlyMap<string, BatchState> {
  const from = liveBatchesFrom(recipes, new Date())
  const to = from ? shiftDateStr(todayStr(), 7) : ''
  const q = useQuery({
    queryKey: qk.foodLog.range(from ?? '', to),
    queryFn: () => fetchFoodLogRange(from!, to),
    enabled: !!from,
    staleTime: STALE.live,
  })
  return useMemo(() => {
    const now = new Date()
    const out = new Map<string, BatchState>()
    for (const r of recipes) {
      if (!r.batch_started_at) continue
      const state = batchState(r, q.data ?? [], now)
      if (state && (state.expired || q.data)) out.set(r.id, state)
    }
    return out
  }, [recipes, q.data])
}

/**
 * The recipe's current batch with what is left of it (foodAmount.batchState):
 * the diary from the day it was made. `excludeEntryId` leaves out the row
 * being edited (its amount is the one on screen). null while loading or with
 * no batch.
 */
export function useRecipeBatch(recipe: RecipeWithIngredients | null | undefined, excludeEntryId?: string): BatchState | null {
  const startDay = localDayOf(recipe?.batch_started_at)
  const to = startDay ? shiftDateStr(startDay, 35) : ''
  const q = useQuery({
    queryKey: qk.foodLog.range(startDay ?? '', to),
    queryFn: () => fetchFoodLogRange(startDay!, to),
    enabled: !!startDay,
    staleTime: STALE.live,
  })
  return useMemo(
    () => (recipe && startDay && q.data ? batchState(recipe, q.data, new Date(), excludeEntryId) : null),
    [recipe, startDay, q.data, excludeEntryId],
  )
}
