import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { formatLocalDate } from '../../../shared/utils/dateUtils'
import { fetchWishes, createWish, updateWish } from '../api/wishesApi'
import { resolveWishWindow } from '../wishRules'
import type { WishItem, CreateWishInput, UpdateWishInput } from '../types'

// One query for the whole feature; every surface narrows it with `select`, so
// mounting the page, Daily's resurfacing row and a popup costs ONE request.
const listQuery = { queryKey: qk.wishes.all, queryFn: fetchWishes, staleTime: STALE.short }

export function useWishes() {
  return useQuery(listQuery)
}

export function useOpenWishes() {
  const today = formatLocalDate(new Date())
  return useQuery({
    ...listQuery,
    select: (rows: WishItem[]) => rows.filter(w =>
      (w.status === 'idea' || w.status === 'planned') && resolveWishWindow(w, today) === 'open'),
  })
}

/** One wish by id (null once the list has loaded without it). */
export function useWish(id: string) {
  return useQuery({ ...listQuery, select: (rows: WishItem[]) => rows.find(w => w.id === id) ?? null })
}

export function useCreateWish() {
  return useMutationWithFeedback({
    action:         'create_wish',
    successMessage: 'Added to your wishes',
    mutationFn:     (input: CreateWishInput) => createWish(input),
    invalidates:    [qk.wishes.all],
  })
}

export function useUpdateWish() {
  return useMutationWithFeedback({
    action:      'update_wish',
    successMessage: (_r, { patch }) => {
      const keys = Object.keys(patch)
      if (keys.length <= 2 && patch.status === 'done') return 'Wish done'
      if (keys.length <= 2 && patch.status === 'planned') return 'Wish planned'
      if (keys.length === 1 && patch.status === 'dropped') return 'Wish dropped'
      return 'Wish saved'
    },
    mutationFn:  ({ id, patch }: { id: string; patch: UpdateWishInput }) => updateWish(id, patch),
    invalidates: [qk.wishes.all],
  })
}

export function useDeleteWish() {
  return useRowsDelete({ table: 'wish_items', action: 'delete_wish', invalidates: [qk.wishes.all], cache: qk.wishes.all })
}
