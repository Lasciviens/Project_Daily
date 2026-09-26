import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchWaterMl, addWaterMl, undoLastWaterMl } from '../api/waterApi'

// Water intake for a day (ml). Every mutation refreshes the whole water root,
// so the Daily card, Food · Today and any future range view stay in sync.
export function useWaterDay(date: string) {
  return useQuery({
    queryKey:  qk.water.day(date),
    queryFn:   () => fetchWaterMl(date),
    staleTime: STALE.live,
  })
}

export function useAddWater(date: string) {
  return useMutationWithFeedback({
    action:      'add_water',
    mutationFn:  (amount_ml: number) => addWaterMl(date, amount_ml),
    invalidates: [qk.water.all],
  })
}

export function useUndoWater(date: string) {
  return useMutationWithFeedback({
    action:      'undo_water',
    mutationFn:  () => undoLastWaterMl(date),
    invalidates: [qk.water.all],
  })
}
