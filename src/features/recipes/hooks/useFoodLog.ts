import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchFoodLog, addFoodLogEntries, deleteFoodLogEntry, updateFoodLogEntry, fetchRecentFoods, fetchFoodLogRange, type LoggedFood } from '../api/foodLogApi'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import type { FoodLogEntry, FoodLogEntryInput } from '../types'

export function useFoodLog(date: string) {
  return useQuery({
    queryKey: ['food-log', date],
    queryFn:  () => fetchFoodLog(date),
    staleTime: 30_000,
  })
}

// The diary over a date range (Meal Plan week view). Same ['food-log'] key
// prefix so the existing invalidation refreshes it after any log/edit/delete.
export function useFoodLogRange(from: string, to: string) {
  return useQuery({
    queryKey: ['food-log', 'range', from, to],
    queryFn:  () => fetchFoodLogRange(from, to),
    staleTime: 30_000,
  })
}

// Most-eaten distinct foods over the last 30 days (from the DIARY), each ready
// to re-log with its own snapshot macros. Feeds the Daily card's recent chips.
export function useRecentFoods() {
  return useQuery({
    queryKey: ['food-log', 'recent-foods'],
    queryFn:  () => fetchRecentFoods(shiftDateStr(todayStr(), -30)),
    staleTime: 5 * 60_000,
  })
}

// Same, but scoped to the 'supplement' slot — the fast re-log chips in the
// dedicated Supplements modal (creatine/whey/etc. you already take).
export function useRecentSupplements() {
  return useQuery({
    queryKey: ['food-log', 'recent-supplements'],
    queryFn:  () => fetchRecentFoods(shiftDateStr(todayStr(), -60), 'supplement'),
    staleTime: 5 * 60_000,
  })
}

function useInvalidateNutrition() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['food-log'] })
    // NutritionCard reads under ['meal-plan','day-nutrition',date] — a plain
    // ['day-nutrition'] key does NOT prefix-match it, so the card would go
    // stale after a log/delete. Invalidate the whole ['meal-plan'] namespace
    // (same one the Recipes meal planner uses) so every nutrition view refreshes.
    qc.invalidateQueries({ queryKey: ['meal-plan'] })
  }
}

export function useAddFoodLogEntries() {
  const invalidate = useInvalidateNutrition()
  return useMutationWithFeedback({
    action:         'add_food_log_entries',
    successMessage: 'Logged ✓',
    mutationFn:     (entries: FoodLogEntryInput[]) => addFoodLogEntries(entries),
    onSuccess:      () => invalidate(),
  })
}

export function useDeleteFoodLogEntry() {
  const invalidate = useInvalidateNutrition()
  return useMutationWithFeedback({
    action:     'delete_food_log_entry',
    mutationFn: ({ id }: { id: string; date: string }) => deleteFoodLogEntry(id),
    onSuccess:  () => invalidate(),
  })
}

export function useUpdateFoodLogEntry() {
  const invalidate = useInvalidateNutrition()
  return useMutationWithFeedback({
    action:         'update_food_log_entry',
    successMessage: 'Updated ✓',
    mutationFn:     ({ id, patch }: { id: string; patch: Parameters<typeof updateFoodLogEntry>[1] }) => updateFoodLogEntry(id, patch),
    onSuccess:      () => invalidate(),
  })
}

export type { LoggedFood }
export type { FoodLogEntry }
