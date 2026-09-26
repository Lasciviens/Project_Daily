import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchShopCategories, createShopCategory,
  fetchShopItems, createShopItem, updateShopItem, deleteShopItem,
} from '../api/shopApi'
import type { CreateShopCategoryInput, CreateShopItemInput, UpdateShopItemInput } from '../types'

export function useShopCategories() {
  return useQuery({
    queryKey:  qk.shop.categories(),
    queryFn:   fetchShopCategories,
    staleTime: STALE.default,
  })
}

// Silent on success: the add-item flow creates categories as steps of one
// save and reports the whole save once.
export function useCreateShopCategory() {
  return useMutationWithFeedback({
    action:      'create_shop_category',
    mutationFn:  (input: CreateShopCategoryInput) => createShopCategory(input),
    invalidates: [qk.shop.categories()],
  })
}

export function useShopItems() {
  return useQuery({
    queryKey:  qk.shop.items(),
    queryFn:   fetchShopItems,
    staleTime: STALE.short,
  })
}

export function useCreateShopItem() {
  return useMutationWithFeedback({
    action:         'create_shop_item',
    successMessage: 'Added to wishlist',
    mutationFn:     (input: CreateShopItemInput) => createShopItem(input),
    invalidates:    [qk.shop.items()],
  })
}

// Silent on success: callers pass their own contextual message ("Marked bought").
export function useUpdateShopItem() {
  return useMutationWithFeedback({
    action:      'update_shop_item',
    // A status flip is a visible move between lists, so it gets a toast;
    // field edits stay silent.
    successMessage: (_d: unknown, { patch }: { patch: UpdateShopItemInput }) =>
      patch.status === 'bought' ? 'Marked bought' : patch.status === 'wishlist' ? 'Back on wishlist' : undefined,
    mutationFn:  ({ id, patch }: { id: string; patch: UpdateShopItemInput }) => updateShopItem(id, patch),
    invalidates: [qk.shop.items()],
  })
}

export function useDeleteShopItem() {
  return useMutationWithFeedback({
    action:         'delete_shop_item',
    successMessage: 'Deleted',
    mutationFn:     (id: string) => deleteShopItem(id),
    invalidates:    [qk.shop.items()],
  })
}
