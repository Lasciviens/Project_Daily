import { useCallback } from 'react'
import { useQueries, type UseQueryResult } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchPricePoints } from '../api/shopApi'
import type { ShopPricePoint } from '../types'

export interface PriceHistories { byId: ReadonlyMap<string, ShopPricePoint[]>; loading: boolean }

/**
 * The price history (shop_price_points) of each row, on the same cache entry
 * the record's sparkline reads. Prototype: one read per row; the build reads
 * them in one call. `loading` is true until every first answer is in; a failed
 * read is simply no history. `ids` should keep its identity between renders.
 */
export function usePriceHistories(ids: readonly string[]): PriceHistories {
  const combine = useCallback((results: UseQueryResult<ShopPricePoint[]>[]): PriceHistories => ({
    byId: new Map(ids.map((id, n) => [id, results[n]?.data ?? []])),
    loading: results.some(r => r.isLoading),
  }), [ids])
  return useQueries({
    queries: ids.map(id => ({ queryKey: qk.shop.points(id), queryFn: () => fetchPricePoints(id), staleTime: STALE.default })),
    combine,
  })
}
