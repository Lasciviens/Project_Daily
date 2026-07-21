import { useQuery, useQueryClient } from '@tanstack/react-query'
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

// Both use useMutationWithFeedback so a failure is ALWAYS toasted + logged to
// app_error_logs even if a call site forgets its own catch (the mandatory
// toast-feedback rule, baked into the primitive). Success stays silent here —
// the one call site (AssignMealModal) shows its own "Saved ✓"/"Removed".
export function useSetMealPlanEntry() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'set_meal_plan_entry',
    mutationFn: (input: CreateMealPlanEntryInput) => setMealPlanEntry(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['meal-plan'] }),
  })
}

export function useDeleteMealPlanEntry() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'delete_meal_plan_entry',
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
