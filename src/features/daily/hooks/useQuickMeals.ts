import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchFoodLog, addFoodLogEntries } from '../../recipes/api/foodLogApi'
import type { FoodLogEntryInput } from '../../recipes/types'
import { shiftDateStr } from '../../../shared/utils/dateUtils'
import { toast } from '../../../app/store'

// ─────────────────────────────────────────────────────────────────────────────
//  Quick-add support for the Daily nutrition card. The card is DIARY-first now
//  (food_log_entries — what was actually eaten): recent
//  chips + copy-yesterday all produce real macros. Recent chips live in
//  useFoodLog's useRecentFoods; this file keeps the plan-row delete (an existing
//  planned entry can still be removed) and copy-yesterday.
// ─────────────────────────────────────────────────────────────────────────────

// Copies yesterday's DIARY into today, but only into slots that are still empty
// today (a slot with anything logged is left alone — copy never overwrites).
// An "As meal" group stays one group (a fresh shared id per source group);
// totals of rows with a source are recalculated from it (migration 106).
// `slots` narrows the copy to specific slots ("same lunch as yesterday").
export function useCopyYesterdayMeals() {
  return useMutationWithFeedback({
    action:         'copy_yesterday_meals',
    successMessage: (copied: number) => (copied > 0 ? `Copied ${copied} item${copied === 1 ? '' : 's'} from yesterday` : undefined),
    mutationFn: async ({ date, filledSlots, slots }: { date: string; filledSlots: Set<string>; slots?: string[] }) => {
      const yesterday = shiftDateStr(date, -1)
      const prev = await fetchFoodLog(yesterday)
      const toCopy = prev.filter(e => !filledSlots.has(e.meal_slot) && (!slots || slots.includes(e.meal_slot)))
      // Nothing to copy is not a failure — say so without an error toast.
      if (toCopy.length === 0) { toast.warning('Nothing to copy from yesterday'); return 0 }
      const newGroup = new Map<string, string>()
      const entries: FoodLogEntryInput[] = toCopy.map(e => {
        let group: string | null = null
        if (e.meal_group_id) {
          group = newGroup.get(e.meal_group_id) ?? crypto.randomUUID()
          newGroup.set(e.meal_group_id, group)
        }
        return {
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
          meal_group_id:         group,
        }
      })
      await addFoodLogEntries(entries)
      return entries.length
    },
    invalidates: ['nutrition'],
  })
}
