import { useMemo } from 'react'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { toast } from '../../../app/store'
import { addFoodLogEntries } from '../api/foodLogApi'
import { recentGuesses, type GuessMacros, type RecentGuess } from '../quickGuess'
import { SLOT_OPTIONS } from '../components/foodLogUtils'
import type { MealSlot } from '../types'
import { useRecentFoods, useRemoveFoodLogEntries } from './useFoodLog'

export interface GuessLog extends GuessMacros {
  date: string
  slot: MealSlot
  /** The diary line's title ("Beer ×2"). */
  title: string
}

/** Your own recent guesses: past one-off lines from the 30-day recents (quickGuess.recentGuesses). */
export function useRecentGuesses(): RecentGuess[] {
  const { data = [] } = useRecentFoods()
  return useMemo(() => recentGuesses(data), [data])
}

/**
 * Logs a guess as a one-off diary line and says so with Undo: "Logged Beer ×2
 * · 430 kcal to snack · Undo". Undo removes that line through the delete flow
 * without asking (it was just added), and that toast can put it back.
 */
export function useLogGuess() {
  const remove = useRemoveFoodLogEntries()
  return useMutationWithFeedback({
    action: 'log_quick_guess',
    silent: 'its own toast with Undo reports the result',
    mutationFn: (g: GuessLog) => addFoodLogEntries([{
      date: g.date, meal_slot: g.slot, custom_title: g.title,
      calories: g.kcal, protein_g: g.protein, carbs_g: g.carbs, fat_g: g.fat, sugar_g: g.sugar,
    }]),
    invalidates: ['nutrition'],
    onSuccess: (ids, g) => {
      const slot = SLOT_OPTIONS.find(o => o.id === g.slot)?.label.toLowerCase() ?? g.slot
      toast.undo(`Logged ${g.title} · ${g.kcal} kcal to ${slot}`, () => {
        void remove.run(ids, { ask: false, title: `Remove “${g.title}”?`, done: `Removed ${g.title}` })
      })
    },
  })
}
