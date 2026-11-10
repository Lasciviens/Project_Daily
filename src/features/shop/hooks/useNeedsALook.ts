import { useMemo } from 'react'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useShopItems } from './useShop'
import { useShopWatches } from './useShopPrices'
import { useDealDays, usePriceStats, useSignalStates } from './useShopSignals'
import { dealsAhead } from '../dealDays'
import { DEAL_AHEAD_DAYS, needsALook, splitLooks, type Look } from '../shopSuggestions'
import { factsOf, watchedWishIds, type PriceFacts } from '../wishTile'
import type { ShopItem } from '../types'

export interface NeedsALookData { looks: Look[]; hidden: Look[]; loading: boolean; failed: boolean; onRetry: () => void }

/**
 * Needs a look's rows from the Shop's own reads — the rows, their price
 * watch, the wishes' clean price figures (one call, shared with the
 * Wishlist's tiles), the deal days and what the owner snoozed or put away.
 * Any of those failing is a failed answer, never "nothing needs a look".
 */
export function useNeedsALook(items: readonly ShopItem[], itemsLoading: boolean): NeedsALookData {
  const today = todayStr()
  const itemsQ = useShopItems()
  const watchQ = useShopWatches()
  const ids = useMemo(() => watchedWishIds(items), [items])
  const stats = usePriceStats(ids)
  const dealsQ = useDealDays()
  const statesQ = useSignalStates()
  const watches = useMemo(() => new Map((watchQ.data ?? []).map(w => [w.item_id, w])), [watchQ.data])
  const facts = useMemo(() => {
    const out = new Map<string, PriceFacts>()
    for (const [id, s] of stats.byId) out.set(id, factsOf(s, today))
    return out
  }, [stats.byId, today])
  const deals = useMemo(() => dealsAhead(dealsQ.data ?? [], today, DEAL_AHEAD_DAYS), [dealsQ.data, today])
  const all = useMemo(() => needsALook(items, { watches, facts, deals }, today), [items, watches, facts, deals, today])
  const { shown, hidden } = useMemo(() => splitLooks(all, statesQ.data ?? [], today), [all, statesQ.data, today])
  const loading = itemsLoading || watchQ.isLoading || stats.loading || dealsQ.isLoading || statesQ.isLoading
  const failed = (!itemsLoading && itemsQ.isError) || (!watchQ.isLoading && watchQ.isError) || stats.failed
    || (!dealsQ.isLoading && dealsQ.isError) || (!statesQ.isLoading && statesQ.isError)
  const onRetry = () => {
    if (itemsQ.isError) void itemsQ.refetch()
    if (watchQ.isError) void watchQ.refetch()
    if (stats.failed) stats.refetch()
    if (dealsQ.isError) void dealsQ.refetch()
    if (statesQ.isError) void statesQ.refetch()
  }
  return { looks: shown, hidden, loading, failed, onRetry }
}
