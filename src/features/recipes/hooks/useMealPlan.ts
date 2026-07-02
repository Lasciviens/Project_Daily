import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchMealPlan, setMealPlanEntry, deleteMealPlanEntry } from '../api/mealPlanApi'
import type { CreateMealPlanEntryInput } from '../types'

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
