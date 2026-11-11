import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchGroceryPrices, lookUpGroceryEan, searchGroceries } from '../api/groceryApi'
import { scanEan, type GroceryHit } from '../groceryModel'

// Grocery prices for the quick list (Kassalapp through `food-search`). Only
// the quick list uses these, so they load with its own chunk.

/** Kassalapp's search takes at least 3 characters (its spec's `minLength: 3`; shorter is a 422). */
export const SEARCH_MIN_CHARS = 3

/** Products for a quick-list row (Kassalapp), while typing — from `SEARCH_MIN_CHARS`. */
export function useGrocerySearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: qk.shop.grocerySearch(q.toLowerCase()),
    queryFn: () => searchGroceries(q),
    enabled: q.length >= SEARCH_MIN_CHARS,
    staleTime: STALE.hour,
    retry: false,
  })
}

/** Today's price of every matched product at each chain (one bulk call). */
export function useGroceryPrices(eans: readonly string[]) {
  const key = [...new Set(eans)].filter(Boolean).sort().join(',')
  return useQuery({
    queryKey: qk.shop.grocery(key),
    queryFn: () => fetchGroceryPrices(key.split(',')),
    enabled: key.length > 0,
    staleTime: STALE.hour,
    retry: false,
  })
}

/**
 * Looks a scanned barcode up by its EAN (Kassalapp's `/products/ean/{ean}`
 * through `food-search`'s `grocery_ean`; its search matches names only, so a
 * code as search words found nothing). The product, or null for a code that
 * isn't an EAN (8–14 digits — never sent) or one Kassalapp doesn't know. A
 * code scanned twice in an hour costs one call; a failed lookup is asked again.
 */
export function useScanLookup(): (code: string) => Promise<GroceryHit | null> {
  const qc = useQueryClient()
  return useCallback((code: string) => {
    const ean = scanEan(code)
    if (!ean) return Promise.resolve(null)
    return qc.fetchQuery({
      queryKey: qk.shop.groceryEan(ean),
      queryFn: () => lookUpGroceryEan(ean),
      staleTime: STALE.hour,
      retry: false,
    })
  }, [qc])
}
