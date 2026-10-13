import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { confirmDelete } from '../../../shared/modals'
import { deleteScope } from '../shopModel'
import { qk, STALE } from '../../../shared/query'
import {
  fetchShopCategories, createShopCategory,
  fetchShopItems, createShopItem, updateShopItem, deleteShopItems, restoreShopItems,
  type ShopSnapshot,
} from '../api/shopApi'
import type { CreateShopCategoryInput, CreateShopItemInput, ShopItem, UpdateShopItemInput } from '../types'

/** Shop's own rows (not the grocery prices: refetching those is a Kassalapp call). */
export const SHOP_ROWS = [qk.shop.items(), qk.shop.links(), qk.shop.costs(), qk.shop.watches()] as const

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
    silent:      'a step of the item form, which reports the save',
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
      quiet ? undefined
        : input.status === 'bought' ? 'Added to your things'
        : input.option_for ? 'Model added'
        : input.list === 'quick' ? 'Added to the quick list' : 'Added to the wishlist',
    mutationFn:     ({ input }: { input: CreateShopItemInput; quiet?: boolean }) => createShopItem(input),
    invalidates:    [qk.shop.items()],
  })
}

type UpdateVars = { id: string; patch: UpdateShopItemInput; quiet?: boolean }

/** The before-trigger's day rules, mirrored so a row lands in the right place before the server answers. */
function applyPatch(r: ShopItem, patch: UpdateShopItemInput, now: string): ShopItem {
  const next = { ...r, ...patch } as ShopItem
  if (patch.status === 'bought' && r.status !== 'bought') next.bought_at = patch.bought_at ?? now
  else if (patch.status && patch.status !== 'bought') { next.bought_at = null; next.disposal = null }
  return next
}

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
        : patch.chain_name !== undefined ? (patch.chain_name ? 'Chain named' : 'Name removed')
        : undefined,
    mutationFn:  ({ id, patch }: UpdateVars) => updateShopItem(id, patch),
    onMutate: async ({ id, patch }: UpdateVars) => {
      await qc.cancelQueries({ queryKey: qk.shop.items() })
      const before = qc.getQueryData<ShopItem[]>(qk.shop.items())
      if (before) {
        const now = new Date().toISOString()
        qc.setQueryData<ShopItem[]>(qk.shop.items(), before.map(r => (r.id === id ? applyPatch(r, patch, now) : r)))
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

/**
 * Bought in one tap: today, the row's own price, store and currency (the rate
 * is the database's). The toast offers Undo, and Add details when there is a
 * record to open (inside the record itself there is nothing more to open).
 */
export function useBuyNow(onDetails?: (id: string) => void) {
  const update = useUpdateShopItem()
  return (item: ShopItem) => {
    update.mutate({ id: item.id, patch: { status: 'bought' }, quiet: true }, {
      onSuccess: () => {
        const undo = () => update.mutate({ id: item.id, patch: { status: 'wishlist' }, quiet: true })
        if (onDetails) toast.doneWith(`Bought · ${item.title}`, { label: 'Add details', onClick: () => onDetails(item.id) }, undo)
        else toast.undo(`Bought · ${item.title}`, undo)
      },
    })
  }
}

/**
 * THE shop delete: asks ("Its 2 accessories go too."), deletes the row and
 * the accessories bought for it (deleteScope), "Deleted Kindle · Undo" — Undo
 * puts them back with their links, costs and accessories (shop_restore_items,
 * migration 137; its own order of parents and links, which the shop rules need).
 */
export function useDeleteShopItems() {
  const items = useShopItems().data ?? []
  const remove = useMutationWithFeedback({
    action:     'delete_shop_items',
    silent:     'the delete flow reports the result',
    mutationFn: (ids: string[]) => deleteShopItems(ids),
    invalidates: SHOP_ROWS,
  })
  const restore = useMutationWithFeedback({
    action:     'restore_shop_items',
    silent:     'the delete flow reports the result',
    mutationFn: async (snapshot: ShopSnapshot) => { await restoreShopItems(snapshot) },
    invalidates: SHOP_ROWS,
  })
  function run(item: ShopItem): Promise<'deleted' | 'kept' | 'gone' | 'failed'> {
    const ids = deleteScope(items, item)
    const more = ids.length - 1
    return confirmDelete<ShopSnapshot>({
      title: `Delete “${item.title}”?`,
      message: more > 0 ? `Its ${more} accessor${more === 1 ? 'y goes' : 'ies go'} too.` : undefined,
      remove: () => remove.mutateAsync(ids),
      isEmpty: snapshot => snapshot.items.length === 0,
      restore: snapshot => restore.mutateAsync(snapshot),
      done: `Deleted ${item.title}`,
    })
  }
  return { run, busy: remove.isPending || restore.isPending }
}
