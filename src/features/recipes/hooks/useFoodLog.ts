import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchFoodLog, addFoodLogEntries, deleteFoodLogEntry } from '../api/foodLogApi'
import type { FoodLogEntryInput } from '../types'

export function useFoodLog(date: string) {
  return useQuery({
    queryKey: ['food-log', date],
    queryFn:  () => fetchFoodLog(date),
    staleTime: 30_000,
  })
}

function useInvalidateNutrition() {
  const qc = useQueryClient()
  return (date: string) => {
    qc.invalidateQueries({ queryKey: ['food-log', date] })
    qc.invalidateQueries({ queryKey: ['day-nutrition'] })
  }
}

export function useAddFoodLogEntries() {
  const invalidate = useInvalidateNutrition()
  return useMutationWithFeedback({
    action:         'add_food_log_entries',
    successMessage: 'Logged ✓',
    mutationFn:     (entries: FoodLogEntryInput[]) => addFoodLogEntries(entries),
    onSuccess:      (_d, entries) => { if (entries[0]) invalidate(entries[0].date) },
  })
}

export function useDeleteFoodLogEntry() {
  const invalidate = useInvalidateNutrition()
  return useMutationWithFeedback({
    action:     'delete_food_log_entry',
    mutationFn: ({ id }: { id: string; date: string }) => deleteFoodLogEntry(id),
    onSuccess:  (_d, vars) => invalidate(vars.date),
  })
}
