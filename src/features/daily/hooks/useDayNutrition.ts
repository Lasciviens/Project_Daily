import { useQuery } from '@tanstack/react-query'
import { fetchDayNutrition } from '../api/dayNutritionApi'
import { qk, STALE } from '../../../shared/query'

// Shares the ['meal-plan'] namespace so writes from the Recipes meal planner
// (useSetMealPlanEntry invalidates ['meal-plan']) refresh this card too.
export function useDayNutrition(date: string) {
  return useQuery({
    queryKey:  qk.mealPlan.dayNutrition(date),
    queryFn:   () => fetchDayNutrition(date),
    staleTime: STALE.live,
  })
}
