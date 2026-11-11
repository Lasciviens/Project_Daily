import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { confirmDelete } from '../../../shared/modals'
import { deleteScope, quickDue, quickFromWishlist } from '../shopModel'
import { qk, STALE } from '../../../shared/query'
import { mapRowsInCache, removeRowsFromCache, restoreCache, snapshotCache, type CacheSnapshot } from '../../../shared/query/cachePatch'
import {
  fetchShopCategories, createShopCategory,
  fetchShopItems, createShopItem, updateShopItem, deleteShopItems, restoreShopItems,
  fetchQuickRows, type ShopQuickRow, type ShopSnapshot,
} from '../api/shopApi'
import type { CreateShopCategoryInput, CreateShopItemInput, ShopItem, UpdateShopItemInput } from '../types'

/**
 * Shop's own rows (not the grocery prices: refetching those is a Kassalapp call). The Needs-a-look states go
 * with them: a deleted thing takes its own, and Delete's Undo puts them back.
 */
export const SHOP_ROWS = [qk.shop.items(), qk.shop.links(), qk.shop.costs(), qk.shop.watches(), qk.shop.signals()] as const

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

/**
 * Daily's Shopping card: what the quick list asks to pick up on `date` — its
 * rows (not No rush), then wishlist errands and deals due at their store —
 * by the Shop page's own rules over a narrow read, never every shop row.
 * While it loads, the Shop page's whole list stands in when it is already
 * here (the same rules pick the same rows from it).
 */
export function useQuickToPickUp(date: string) {
  const qc = useQueryClient()
  const pickUp = useCallback((rows: ShopQuickRow[]): ShopQuickRow[] => {
    // The rules read only QUICK_ROW_COLUMNS (scripts/verify-shop-api.cjs), so the narrow rows go through as they are.
    const all = rows as ShopItem[]
    return [...quickDue(all), ...quickFromWishlist(all, date)]
  }, [date])
  return useQuery({
    queryKey:        qk.shop.quick(),
    queryFn:         fetchQuickRows,
    staleTime:       STALE.short,
    select:          pickUp,
    placeholderData: () => qc.getQueryData<ShopItem[]>(qk.shop.items()),
  })
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

/**
 * Buy again in one tap: a fresh quick-list row from an earlier purchase
 * (`buyAgainInput`), "On the quick list · Milk · Undo". The stored row goes
 * into the cached list as soon as the database answers, so the suggestion
 * leaves at once; Undo takes that fresh row off again (the shop delete — a
 * row made a moment ago has nothing hanging on it) and says so.
 */
export function useAddAgain() {
  const qc = useQueryClient()
  const undo = useMutationWithFeedback({
    action:         'undo_shop_buy_again',
    successMessage: (_d: unknown, row: ShopItem) => `Taken off the quick list · ${row.title}`,
    mutationFn:     async (row: ShopItem) => { await deleteShopItems([row.id]) },
    onSuccess:      (_d, row) => removeRowsFromCache(qc, qk.shop.items(), new Set([row.id])),
    invalidates:    SHOP_ROWS,
  })
  const add = useMutationWithFeedback({
    action:      'shop_buy_again',
    silent:      'its toast with Undo reports it',
    mutationFn:  (input: CreateShopItemInput) => createShopItem(input),
    onSuccess:   (row: ShopItem) => {
      qc.setQueryData<ShopItem[]>(qk.shop.items(), rows => (rows && !rows.some(r => r.id === row.id) ? [...rows, row] : rows))
      toast.undo(`On the quick list · ${row.title}`, () => undo.mutate(row))
    },
    invalidates: [qk.shop.items()],
  })
  return { add: (input: CreateShopItemInput) => add.mutate(input), busy: add.isPending }
}

/** `row`: the row as it was before an earlier write, for an Undo that brings it back onto Daily's list. */
type UpdateVars = { id: string; patch: UpdateShopItemInput; quiet?: boolean; row?: ShopQuickRow }

/** The before-trigger's day rules, mirrored so a row lands in the right place before the server answers. */
function applyPatch(r: ShopItem, patch: UpdateShopItemInput, now: string): ShopItem {
  const next = { ...r, ...patch } as ShopItem
  if (patch.status === 'bought' && r.status !== 'bought') next.bought_at = patch.bought_at ?? now
  else if (patch.status && patch.status !== 'bought') { next.bought_at = null; next.disposal = null }
  return next
}

/**
 * Optimistic: a tick on the quick list or a status flip shows at once — in
 * every cached list of shop rows, the page's and Daily's — and rolls back on
 * failure. A status flip toasts unless `quiet` (ticking off groceries one by
 * one would bury the screen in toasts); field edits never do.
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
    onMutate: async ({ id, patch, row }: UpdateVars) => {
      await qc.cancelQueries({ queryKey: qk.shop.items() })
      const before = snapshotCache(qc, qk.shop.items())
      // Daily's narrow read holds only rows to buy: a row an earlier write bought (and its refresh took out) comes back with it.
      if (row) qc.setQueryData<ShopQuickRow[]>(qk.shop.quick(), rows => (rows && !rows.some(r => r.id === id) ? [...rows, row] : rows))
      const now = new Date().toISOString()
      mapRowsInCache<ShopItem>(qc, qk.shop.items(), new Set([id]), r => applyPatch(r, patch, now))
      return { before }
    },
    onError: (_e, _v, ctx) => {
      const c = ctx as { before?: CacheSnapshot } | undefined
      if (c?.before) restoreCache(qc, c.before)
    },
    invalidates: [qk.shop.items()],
  })
}

/**
 * Bought in one tap: today, the row's own price, store and currency (the rate
 * is the database's). The toast offers Undo, and Add details when there is a
 * record to open (inside the record itself there is nothing more to open) —
 * or, with `thenDetails` (a wish: Just bought), opens them right away.
 */
export function useBuyNow(onDetails?: (id: string) => void, { thenDetails = false }: { thenDetails?: boolean } = {}) {
  const update = useUpdateShopItem()
  return (item: ShopQuickRow) => {
    update.mutate({ id: item.id, patch: { status: 'bought' }, quiet: true }, {
      onSuccess: () => {
        const undo = () => update.mutate({ id: item.id, patch: { status: 'wishlist' }, quiet: true, row: item })
        if (onDetails && thenDetails) { toast.undo(`Bought · ${item.title}`, undo); onDetails(item.id) }
        else if (onDetails) toast.doneWith(`Bought · ${item.title}`, { label: 'Add details', onClick: () => onDetails(item.id) }, undo)
        else toast.undo(`Bought · ${item.title}`, undo)
      },
    })
  }
}

/**
 * THE shop delete: asks ("Its 2 accessories go too."), deletes the row and
 * the accessories bought for it (deleteScope), "Deleted Kindle · Undo" — Undo
 * puts them back with their links, costs, accessories and price history
 * (shop_restore_items, migration 187: the rows first, then their parents and
 * links, which the shop rules need).
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
