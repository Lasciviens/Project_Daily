import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { fetchWishes, createWish, updateWish, deleteWish } from '../api/wishesApi'
import { resolveWishWindow } from '../wishRules'
import type { WishItem, CreateWishInput, UpdateWishInput } from '../types'

// One query namespace for the whole feature; every mutation invalidates it.
const WISHES_KEY = ['wish-items'] as const
const STALE_TIME = 60_000

export function useWishes() {
  return useQuery({ queryKey: WISHES_KEY, queryFn: fetchWishes, staleTime: STALE_TIME })
}

// Same key + same queryFn as useWishes, narrowed with `select` — so mounting
// both surfaces costs ONE network query, not two.
export function useOpenWishes() {
  const today = formatLocalDate(new Date())
  return useQuery({
    queryKey:  WISHES_KEY,
    queryFn:   fetchWishes,
    staleTime: STALE_TIME,
    select:    (rows: WishItem[]) => rows.filter(w =>
      (w.status === 'idea' || w.status === 'planned') && resolveWishWindow(w, today) === 'open'),
  })
}

export function useCreateWish() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'create_wish',
    successMessage: 'Added to your wishes',
    mutationFn:     (input: CreateWishInput) => createWish(input),
    onSuccess:      () => qc.invalidateQueries({ queryKey: WISHES_KEY }),
  })
}

export function useUpdateWish() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'update_wish',
    mutationFn: ({ id, patch }: { id: string; patch: UpdateWishInput }) => updateWish(id, patch),
    onSuccess:  () => qc.invalidateQueries({ queryKey: WISHES_KEY }),
  })
}

export function useDeleteWish() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_wish',
    successMessage: 'Deleted',
    mutationFn:     (id: string) => deleteWish(id),
    onSuccess:      () => qc.invalidateQueries({ queryKey: WISHES_KEY }),
  })
}
