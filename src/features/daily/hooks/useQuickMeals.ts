import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchMealPlan, setMealPlanEntry, deleteMealPlanEntry } from '../../recipes/api/mealPlanApi'
import type { MealSlot } from '../../recipes/types'
import { shiftDateStr } from '../../../shared/utils/dateUtils'

// ─────────────────────────────────────────────────────────────────────────────
//  Quick-add support for the Daily nutrition card. Live-data reality check
//  (2026-07): the user's meal plan is 100% free-text custom entries — recipes
//  and the ingredient library are effectively unused — so quick-add leads
//  with recent titles + free text, not recipe pickers.
// ─────────────────────────────────────────────────────────────────────────────

export interface RecentMeal {
  title:     string
  recipeId:  string | null   // kept so re-adding a recipe entry stays a recipe entry
  count:     number
}

// Most-used meal titles from the last 30 days — the "recent meals" chips.
export function useRecentMeals() {
  return useQuery({
    queryKey: ['meal-plan', 'recent-titles'],
    queryFn: async (): Promise<RecentMeal[]> => {
      const today = new Date().toISOString().slice(0, 10)
      const entries = await fetchMealPlan(shiftDateStr(today, -30), today)
      const byTitle = new Map<string, RecentMeal>()
      for (const e of entries) {
        const title = e.custom_title ?? e.recipe?.title
        if (!title) continue
        const existing = byTitle.get(title)
        if (existing) existing.count++
        else byTitle.set(title, { title, recipeId: e.recipe_id, count: 1 })
      }
      return [...byTitle.values()].sort((a, b) => b.count - a.count).slice(0, 8)
    },
    staleTime: 5 * 60_000,
  })
}

export function useSetQuickMeal() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'quick_add_meal',
    mutationFn: (input: { date: string; slot: MealSlot; title: string; recipeId?: string | null }) =>
      setMealPlanEntry({
        date:         input.date,
        meal_slot:    input.slot,
        recipe_id:    input.recipeId ?? null,
        custom_title: input.recipeId ? null : input.title,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal-plan'] }),
  })
}

export function useDeleteQuickMeal() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'delete_meal_entry',
    mutationFn: (id: string) => deleteMealPlanEntry(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['meal-plan'] }),
  })
}

// Copies every yesterday entry into today's still-empty slots (upsert per
// slot; a slot already filled today is left alone — copy never overwrites).
export function useCopyYesterdayMeals() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'copy_yesterday_meals',
    successMessage: 'Copied from yesterday ✓',
    mutationFn: async ({ date, filledSlots }: { date: string; filledSlots: Set<string> }) => {
      const yesterday = shiftDateStr(date, -1)
      const prev = await fetchMealPlan(yesterday, yesterday)
      const toCopy = prev.filter(e => !filledSlots.has(e.meal_slot))
      if (toCopy.length === 0) throw new Error('Nothing to copy from yesterday')
      for (const e of toCopy) {
        await setMealPlanEntry({
          date,
          meal_slot:             e.meal_slot,
          recipe_id:             e.recipe_id,
          custom_title:          e.custom_title,
          library_ingredient_id: e.library_ingredient_id,
          ingredient_quantity:   e.ingredient_quantity,
          ingredient_unit:       e.ingredient_unit,
          servings:              e.servings,
          notes:                 e.notes,
        })
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['meal-plan'] }),
  })
}
