import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { invalidate } from '../../../shared/query/invalidate'
import { logError } from '../../../shared/utils/logError'
import { toast } from '../../../app/store'
import {
  fetchFoodLog, addFoodLogEntries, deleteFoodLogEntry, updateFoodLogEntry, fetchRecentFoods, fetchFoodLogRange,
  fetchFoodLogEntry, fetchFoodFavorites, deleteFoodLogEntriesReturning, restoreFoodLogEntries, addFoodFavorite, removeFoodFavorite, hideRecentFood, type LoggedFood, type RecentFood,
} from '../api/foodLogApi'
import { shiftDateStr, todayStr } from '../../../shared/utils/dateUtils'
import type { FoodLogEntry, FoodLogEntryInput } from '../types'

export function useFoodLog(date: string) {
  return useQuery({
    queryKey: qk.foodLog.day(date),
    queryFn:  () => fetchFoodLog(date),
    staleTime: STALE.live,
  })
}

// The diary over a date range (Meal Plan week view). Same ['food-log'] key
// prefix so the existing invalidation refreshes it after any log/edit/delete.
export function useFoodLogRange(from: string, to: string) {
  return useQuery({
    queryKey: qk.foodLog.range(from, to),
    queryFn:  () => fetchFoodLogRange(from, to),
    staleTime: STALE.live,
  })
}

// Most-eaten distinct foods over the last 30 days (from the DIARY), each ready
// to re-log with its own snapshot macros. Feeds the Daily card's recent chips.
export function useRecentFoods() {
  return useQuery({
    queryKey: qk.foodLog.recents(),
    queryFn:  () => fetchRecentFoods(shiftDateStr(todayStr(), -30)),
    staleTime: STALE.default,
  })
}

/** One diary row by id (the edit popup's source of truth). */
export function useFoodLogEntry(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.foodLog.entry(id ?? ''),
    queryFn:  () => fetchFoodLogEntry(id!),
    enabled:  !!id,
    staleTime: STALE.live,
  })
}

// Every write below refreshes the whole `nutrition` group: the Daily card
// reads under ['meal-plan','day-nutrition',date], which a food-log-only
// invalidation would miss (the documented stale-ring bug).
export function useAddFoodLogEntries() {
  return useMutationWithFeedback({
    action:         'add_food_log_entries',
    successMessage: (_: void, entries: FoodLogEntryInput[]) =>
      entries.length > 1 ? `Logged ${entries.length} items` : `Logged to ${entries[0]?.meal_slot ?? 'diary'}`,
    mutationFn:     (entries: FoodLogEntryInput[]) => addFoodLogEntries(entries),
    invalidates:    ['nutrition'],
  })
}

export function useDeleteFoodLogEntry() {
  return useMutationWithFeedback({
    action:      'delete_food_log_entry',
    mutationFn:  ({ id }: { id: string; date: string }) => deleteFoodLogEntry(id),
    invalidates: ['nutrition'],
  })
}

// Removes one diary row — or a whole "As meal" group — right away and offers
// Undo, instead of a blocking confirm. Undo re-inserts the rows unchanged.
export function useRemoveFoodLogEntries() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:      'remove_food_log_entries',
    mutationFn:  ({ ids }: { ids: string[]; label: string }) => deleteFoodLogEntriesReturning(ids),
    invalidates: ['nutrition'],
    onSuccess: (rows, { label }) => {
      if (rows.length === 0) return
      toast.undo(`Removed ${label}`, () => {
        restoreFoodLogEntries(rows)
          .then(() => { invalidate(qc, 'nutrition'); toast.success('Restored') })
          .catch((e: Error) => { toast.error(e.message || 'Could not restore'); logError(`restore_food_log_entries: ${e.message}`, { action: 'restore_food_log_entries' }) })
      })
    },
  })
}

export function useUpdateFoodLogEntry() {
  return useMutationWithFeedback({
    action:         'update_food_log_entry',
    successMessage: 'Updated',
    mutationFn:     ({ id, patch }: { id: string; patch: Parameters<typeof updateFoodLogEntry>[1] }) => updateFoodLogEntry(id, patch),
    invalidates:    ['nutrition'],
  })
}

// Pinned shortcuts (migration 087) — separate from "Recent" (which is only
// ever derived from eaten history) so a food can stay reachable even if it
// hasn't been logged in a while.
export function useFoodFavorites() {
  return useQuery({
    queryKey: qk.foodLog.favorites(),
    queryFn:  fetchFoodFavorites,
    staleTime: STALE.short,
  })
}

export function useAddFoodFavorite() {
  return useMutationWithFeedback({
    action:         'add_food_favorite',
    successMessage: 'Added to favourites',
    mutationFn:     (food: RecentFood) => addFoodFavorite(food),
    invalidates:    [qk.foodLog.favorites()],
  })
}

export function useRemoveFoodFavorite() {
  return useMutationWithFeedback({
    action:      'remove_food_favorite',
    mutationFn:  (foodKey: string) => removeFoodFavorite(foodKey),
    invalidates: [qk.foodLog.favorites()],
  })
}

// "Remove from Recent" — a standing preference (migration 087), not a
// one-off dismissal; persists across sessions/devices.
export function useHideRecentFood() {
  return useMutationWithFeedback({
    action:         'hide_recent_food',
    successMessage: 'Removed from recent',
    mutationFn:     (foodKey: string) => hideRecentFood(foodKey),
    invalidates:    [qk.foodLog.recents()],
  })
}

export type { LoggedFood }
export type { FoodLogEntry }
