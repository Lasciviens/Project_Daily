import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchMealPlan, setMealPlanEntry, deleteMealPlanEntry, eatPlannedEntry } from '../api/mealPlanApi'
import type { CreateMealPlanEntryInput, MealPlanEntry } from '../types'

export function useMealPlan(weekStart: string, weekEnd: string) {
  return useQuery({
    queryKey:  ['meal-plan', weekStart, weekEnd],
    queryFn:   () => fetchMealPlan(weekStart, weekEnd),
    staleTime: 30_000,
  })
}

export function useSetMealPlanEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateMealPlanEntryInput) => setMealPlanEntry(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['meal-plan'] }),
  })
}

export function useDeleteMealPlanEntry() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteMealPlanEntry(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['meal-plan'] }),
  })
}

// Confirm a planned meal as eaten → it starts counting in the day's totals.
export function useEatPlannedEntry() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'eat_planned_entry',
    successMessage: 'Logged as eaten ✓',
    mutationFn:     (entry: MealPlanEntry) => eatPlannedEntry(entry),
    onSuccess:      () => { qc.invalidateQueries({ queryKey: ['meal-plan'] }); qc.invalidateQueries({ queryKey: ['food-log'] }) },
  })
}
