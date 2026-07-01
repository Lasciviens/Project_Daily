import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchShopCategories, createShopCategory, deleteShopCategory,
  fetchShopItems, createShopItem, updateShopItem, deleteShopItem,
} from '../api/shopApi'
import type { CreateShopCategoryInput, CreateShopItemInput, UpdateShopItemInput } from '../types'

export function useShopCategories() {
  return useQuery({
    queryKey:  ['shop', 'categories'],
    queryFn:   fetchShopCategories,
    staleTime: 5 * 60_000,
  })
}

export function useCreateShopCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateShopCategoryInput) => createShopCategory(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['shop', 'categories'] }),
  })
}

export function useDeleteShopCategory() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteShopCategory(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['shop'] }),
  })
}

export function useShopItems() {
  return useQuery({
    queryKey:  ['shop', 'items'],
    queryFn:   fetchShopItems,
    staleTime: 60_000,
  })
}

export function useCreateShopItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateShopItemInput) => createShopItem(input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['shop', 'items'] }),
  })
}

export function useUpdateShopItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateShopItemInput }) => updateShopItem(id, patch),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['shop', 'items'] }),
  })
}

export function useDeleteShopItem() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteShopItem(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['shop', 'items'] }),
  })
}
