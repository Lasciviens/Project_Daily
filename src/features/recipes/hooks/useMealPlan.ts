import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchMealPlan, fetchMealPlanEntry, setMealPlanEntry, eatPlannedEntry } from '../api/mealPlanApi'
import type { CreateMealPlanEntryInput, MealPlanEntry } from '../types'

export function useMealPlan(weekStart: string, weekEnd: string) {
  return useQuery({
    queryKey:  qk.mealPlan.week(weekStart, weekEnd),
    queryFn:   () => fetchMealPlan(weekStart, weekEnd),
    staleTime: STALE.live,
  })
}

/** One planned row by id — what the plan popup edits. */
export function useMealPlanEntry(id: string | null | undefined) {
  return useQuery({
    queryKey:  qk.mealPlan.entry(id ?? ''),
    queryFn:   () => fetchMealPlanEntry(id!),
    enabled:   !!id,
    staleTime: STALE.live,
  })
}

// A planned row lives in food_log_entries, so every plan write refreshes the
// whole nutrition group (plan grid, day card, diary).
export function useSetMealPlanEntry() {
  return useMutationWithFeedback({
    action:         'set_meal_plan_entry',
    successMessage: 'Saved',
    mutationFn:     (input: CreateMealPlanEntryInput) => setMealPlanEntry(input),
    invalidates:    ['nutrition'],
  })
}

/** A planned meal is a diary row (migration 061): the same delete, with Undo. */
export { useRemoveFoodLogEntries as useDeleteMealPlanEntry } from './useFoodLog'

// Confirm a planned meal as eaten → it starts counting in the day's totals.
export function useEatPlannedEntry() {
  return useMutationWithFeedback({
    action:         'eat_planned_entry',
    successMessage: 'Logged as eaten',
    mutationFn:     (entry: MealPlanEntry) => eatPlannedEntry(entry),
    invalidates:    ['nutrition'],
  })
}
