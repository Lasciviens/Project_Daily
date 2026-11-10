import { useMemo } from 'react'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useShopItems } from './useShop'
import { useShopWatches } from './useShopPrices'
import { useDealDays, usePriceStats, useSignalStates } from './signalStandIns'
import { needsALook, splitLooks, type Look } from '../shopSuggestions'
import { watchedWishIds } from '../wishTile'
import type { ShopItem } from '../types'

export interface NeedsALookData { looks: Look[]; hidden: Look[]; loading: boolean; failed: boolean; onRetry: () => void }

/**
 * Needs a look's rows from the Shop's own reads — the rows, their price
 * watch, the wishes' clean price history (one call, shared with the
 * Wishlist's tiles), the deal days and what the owner snoozed or put away.
 * Any of those failing is a failed answer, never "nothing needs a look".
 */
export function useNeedsALook(items: readonly ShopItem[], itemsLoading: boolean): NeedsALookData {
  const today = todayStr()
  const itemsQ = useShopItems()
  const watchQ = useShopWatches()
  const ids = useMemo(() => watchedWishIds(items), [items])
  const stats = usePriceStats(ids)
  const deals = useDealDays()
  const statesQ = useSignalStates()
  const watches = useMemo(() => new Map((watchQ.data ?? []).map(w => [w.item_id, w])), [watchQ.data])
  const all = useMemo(() => needsALook(items, { watches, facts: stats.data, deals }, today), [items, watches, stats.data, deals, today])
  const { shown, hidden } = useMemo(() => splitLooks(all, statesQ.data ?? [], today), [all, statesQ.data, today])
  const loading = itemsLoading || watchQ.isLoading || stats.isLoading || statesQ.isLoading
  const failed = (!itemsLoading && itemsQ.isError) || (!watchQ.isLoading && watchQ.isError)
    || (!stats.isLoading && stats.isError) || (!statesQ.isLoading && statesQ.isError)
  const onRetry = () => {
    if (itemsQ.isError) void itemsQ.refetch()
    if (watchQ.isError) void watchQ.refetch()
    if (stats.isError) stats.refetch()
    if (statesQ.isError) void statesQ.refetch()
  }
  return { looks: shown, hidden, loading, failed, onRetry }
}
