import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { logError } from '../../../shared/utils/logError'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchPricePoints, fetchPriceWatches } from '../api/shopApi'
import { checkItemPrices, type PriceCheckOutcome } from '../api/shopPriceApi'
import { fetchGroceryPrices, searchGroceries } from '../api/groceryApi'
import type { GroceryHit } from '../groceryModel'
import type { ShopPriceWatch } from '../types'

// The price watch (shop-price, migration 137) and grocery prices (Kassalapp).

export function useShopWatches() {
  return useQuery({ queryKey: qk.shop.watches(), queryFn: fetchPriceWatches, staleTime: STALE.default })
}

/** The watch rows by item id. */
export function useWatchMap(): Map<string, ShopPriceWatch> {
  const { data = [] } = useShopWatches()
  return useMemo(() => new Map(data.map(w => [w.item_id, w])), [data])
}

/** One row's price history — only once its popup asks. */
export function useShopPricePoints(itemId: string | null) {
  return useQuery({
    queryKey: qk.shop.points(itemId ?? ''),
    queryFn: () => fetchPricePoints(itemId as string),
    enabled: !!itemId,
    staleTime: STALE.default,
  })
}

/**
 * "Check now": re-reads the links. One link that read nothing is an error
 * with the reason (the watch still records the check); several report a count.
 */
export function useCheckPrices() {
  return useMutationWithFeedback({
    action:         'check_shop_prices',
    loadingMessage: 'Checking the price…',
    successMessage: (r: PriceCheckOutcome[]) => (r.length === 1 ? 'Price checked' : `Checked ${r.length} links · ${r.filter(x => x.status === 'ok').length} with a price`),
    mutationFn:     async (ids: string[]) => {
      const r = await checkItemPrices(ids)
      if (r.length === 1 && r[0].status !== 'ok') throw new Error(r[0].error ?? 'No price found on the page')
      return r
    },
    invalidates:    (_d, ids) => [qk.shop.watches(), ...ids.map(id => qk.shop.points(id))],
  })
}

/** A check in the background (a link just saved): no toasts; the watch fills in when it is done. */
export function useQuietCheck() {
  const qc = useQueryClient()
  return (ids: string[]) => {
    if (!ids.length) return
    checkItemPrices(ids)
      .then(() => qc.invalidateQueries({ queryKey: qk.shop.watches() }))
      .catch((e: Error) => logError(`shop_quiet_check: ${e.message}`, { action: 'shop_quiet_check' }))
  }
}

/** Products for a quick-list row (Kassalapp), while typing. */
export function useGrocerySearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: qk.shop.grocerySearch(q.toLowerCase()),
    queryFn: () => searchGroceries(q),
    enabled: q.length >= 2,
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
 * Looks a scanned barcode up through Kassalapp's search (it takes an EAN as
 * the query), on the same cache entry `useGrocerySearch` reads — a code
 * scanned twice in an hour costs one call. A failed lookup is asked again.
 */
export function useScanLookup(): (code: string) => Promise<GroceryHit[]> {
  const qc = useQueryClient()
  return useCallback((code: string) => qc.fetchQuery({
    queryKey: qk.shop.grocerySearch(code.toLowerCase()),
    queryFn: () => searchGroceries(code),
    staleTime: STALE.hour,
    retry: false,
  }), [qc])
}
