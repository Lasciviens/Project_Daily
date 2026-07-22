import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchWaterMl, addWaterMl, undoLastWaterMl } from '../api/waterApi'

// Water intake for a day (ml). Own query namespace; every mutation invalidates
// it so the Daily card and Food · Today (both consumers) stay in sync.
export function useWaterDay(date: string) {
  return useQuery({
    queryKey:  ['water', date],
    queryFn:   () => fetchWaterMl(date),
    staleTime: 30_000,
  })
}

export function useAddWater(date: string) {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'add_water',
    mutationFn: (amount_ml: number) => addWaterMl(date, amount_ml),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['water', date] }),
  })
}

export function useUndoWater(date: string) {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'undo_water',
    mutationFn: () => undoLastWaterMl(date),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['water', date] }),
  })
}
