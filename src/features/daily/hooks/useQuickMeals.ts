import { useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { deleteMealPlanEntry } from '../../recipes/api/mealPlanApi'
import { fetchFoodLog, addFoodLogEntries } from '../../recipes/api/foodLogApi'
import type { FoodLogEntryInput } from '../../recipes/types'
import { shiftDateStr } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  Quick-add support for the Daily nutrition card. The card is DIARY-first now
//  (food_log_entries — what was actually eaten, macros snapshotted): recent
//  chips + copy-yesterday all produce real macros. Recent chips live in
//  useFoodLog's useRecentFoods; this file keeps the plan-row delete (an existing
//  planned entry can still be removed) and copy-yesterday.
// ─────────────────────────────────────────────────────────────────────────────

// Deletes an existing PLANNED entry (recipe_meal_plans) — diary rows are
// deleted via useDeleteFoodLogEntry instead.
export function useDeleteQuickMeal() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'delete_meal_entry',
    mutationFn: (id: string) => deleteMealPlanEntry(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['meal-plan'] }),
  })
}

// Copies yesterday's DIARY into today, but only into slots that are still empty
// today (a slot with anything logged is left alone — copy never overwrites).
// Each copied row carries yesterday's snapshot macros forward.
export function useCopyYesterdayMeals() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'copy_yesterday_meals',
    successMessage: 'Copied from yesterday ✓',
    mutationFn: async ({ date, filledSlots }: { date: string; filledSlots: Set<string> }) => {
      const yesterday = shiftDateStr(date, -1)
      const prev = await fetchFoodLog(yesterday)
      const toCopy = prev.filter(e => !filledSlots.has(e.meal_slot))
      if (toCopy.length === 0) throw new Error('Nothing to copy from yesterday')
      const entries: FoodLogEntryInput[] = toCopy.map(e => ({
        date,
        meal_slot:             e.meal_slot,
        library_ingredient_id: e.library_ingredient_id,
        recipe_id:             e.recipe_id,
        custom_title:          e.custom_title,
        quantity:              e.quantity,
        unit:                  e.unit,
        calories:              e.calories,
        protein_g:             e.protein_g,
        carbs_g:               e.carbs_g,
        fat_g:                 e.fat_g,
        fiber_g:               e.fiber_g,
        sugar_g:               e.sugar_g,
      }))
      await addFoodLogEntries(entries)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['food-log'] })
      qc.invalidateQueries({ queryKey: ['meal-plan'] })
    },
  })
}
