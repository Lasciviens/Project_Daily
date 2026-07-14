import { useQuery } from '@tanstack/react-query'
import { fetchDayNutrition } from '../api/dayNutritionApi'

// Shares the ['meal-plan'] namespace so writes from the Recipes meal planner
// (useSetMealPlanEntry invalidates ['meal-plan']) refresh this card too.
export function useDayNutrition(date: string) {
  return useQuery({
    queryKey:  ['meal-plan', 'day-nutrition', date],
    queryFn:   () => fetchDayNutrition(date),
    staleTime: 30_000,
  })
}
