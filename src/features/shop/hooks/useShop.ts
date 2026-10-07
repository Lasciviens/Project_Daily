import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { logError } from '../../../shared/utils/logError'
import { qk, STALE } from '../../../shared/query'
import {
  fetchShopCategories, createShopCategory,
  fetchShopItems, createShopItem, updateShopItem, deleteShopItems, restoreShopItems,
} from '../api/shopApi'
import type { CreateShopCategoryInput, CreateShopItemInput, ShopItem, UpdateShopItemInput } from '../types'

export function useShopCategories() {
  return useQuery({
    queryKey:  qk.shop.categories(),
    queryFn:   fetchShopCategories,
    staleTime: STALE.default,
  })
}

// Silent on success: the item form creates categories as steps of one save
// and reports the whole save once.
export function useCreateShopCategory() {
  return useMutationWithFeedback({
    action:      'create_shop_category',
    mutationFn:  (input: CreateShopCategoryInput) => createShopCategory(input),
    invalidates: [qk.shop.categories()],
  })
}

const itemsQuery = {
  queryKey:  qk.shop.items(),
  queryFn:   fetchShopItems,
  staleTime: STALE.short,
}

export function useShopItems() {
  return useQuery(itemsQuery)
}

/** One row from the shared items query (the `shop-item` popup loads by id). */
export function useShopItem(id: string) {
  return useQuery({ ...itemsQuery, select: (rows: ShopItem[]) => rows.find(r => r.id === id) ?? null })
}

/** `quiet`: the quick list's own add box shows the row appear instead of a toast. */
export function useCreateShopItem() {
  return useMutationWithFeedback({
    action:         'create_shop_item',
    successMessage: (_d: ShopItem, { input, quiet }: { input: CreateShopItemInput; quiet?: boolean }) =>
      quiet ? undefined : input.list === 'quick' ? 'Added to the quick list' : 'Added to the wishlist',
    mutationFn:     ({ input }: { input: CreateShopItemInput; quiet?: boolean }) => createShopItem(input),
    invalidates:    [qk.shop.items()],
  })
}

type UpdateVars = { id: string; patch: UpdateShopItemInput; quiet?: boolean }

/**
 * Optimistic: a tick on the quick list or a status flip shows at once and
 * rolls back on failure. A status flip toasts unless `quiet` (ticking off
 * groceries one by one would bury the screen in toasts); field edits never do.
 */
export function useUpdateShopItem() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:      'update_shop_item',
    successMessage: (_d: unknown, { patch, quiet }: UpdateVars) =>
      quiet ? undefined
        : patch.status === 'bought' ? 'Marked bought'
        : patch.status === 'wishlist' ? 'Back on the list'
        : patch.status === 'dropped' ? 'Moved to Not any more'
        : patch.list === 'quick' ? 'Moved to the quick list'
        : patch.list === 'wishlist' ? 'Moved to the wishlist'
        : undefined,
    mutationFn:  ({ id, patch }: UpdateVars) => updateShopItem(id, patch),
    onMutate: async ({ id, patch }: UpdateVars) => {
      await qc.cancelQueries({ queryKey: qk.shop.items() })
      const before = qc.getQueryData<ShopItem[]>(qk.shop.items())
      if (before) {
        const now = new Date().toISOString()
        qc.setQueryData<ShopItem[]>(qk.shop.items(), before.map(r => {
          if (r.id !== id) return r
          const next = { ...r, ...patch } as ShopItem
          // The trigger's rule, mirrored so the row lands in the right place at once.
          if (patch.status === 'bought' && r.status !== 'bought') next.bought_at = patch.bought_at ?? now
          else if (patch.status && patch.status !== 'bought') next.bought_at = null
          return next
        }))
      }
      return { before }
    },
    onError: (_e, _v, ctx) => {
      const c = ctx as { before?: ShopItem[] } | undefined
      if (c?.before) qc.setQueryData(qk.shop.items(), c.before)
    },
    invalidates: [qk.shop.items()],
  })
}

/** Deletes at once and offers Undo (the rows are put back exactly as they were). */
export function useDeleteShopItems() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'delete_shop_items',
    mutationFn: ({ ids }: { ids: string[]; label: string }) => deleteShopItems(ids),
    invalidates: [qk.shop.items()],
    onSuccess: (rows, { label }) => {
      if (!rows.length) return
      toast.undo(`Deleted ${label}`, () => {
        restoreShopItems(rows)
          .then(() => { void qc.invalidateQueries({ queryKey: qk.shop.items() }); toast.success('Restored') })
          .catch((e: Error) => { toast.error(e.message || 'Could not restore'); logError(`restore_shop_items: ${e.message}`, { action: 'restore_shop_items' }) })
      })
    },
  })
}
