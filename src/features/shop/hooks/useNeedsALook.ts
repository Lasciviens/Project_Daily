import { useMemo } from 'react'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useShopItems } from './useShop'
import { useShopWatches } from './useShopPrices'
import { useDealDays, usePriceStats, useSignalStates } from './useShopSignals'
import { useShopCosts } from './useShopMoney'
import { useStoreLooks } from './useStoreLooks'
import { dealsAhead } from '../dealDays'
import { DEAL_AHEAD_DAYS, needsALook, splitLooks, type Look } from '../shopSuggestions'
import { useShopNotices } from '../../notifications/hooks/useNotifications'
import { factsOf, watchedWishIds, type PriceFacts } from '../wishTile'
import type { ShopItem } from '../types'

const NO_COSTS: never[] = []

export interface NeedsALookData {
  looks: Look[]
  hidden: Look[]
  /** The unread Shop notices (the bell's list shows them in the sheet, after the urgent rows): counted on the button. */
  notices: number
  loading: boolean
  failed: boolean
  onRetry: () => void
}

/**
 * Needs a look's rows from the Shop's own reads — the rows, their price
 * watch, the wishes' clean price figures (one call, shared with the
 * Wishlist's tiles), the deal days, what the owner snoozed or put away, and
 * the stores' rules (191: price protection, money got back, price match).
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
    for (const [id, s] of stats.byId) out.set(id, factsOf(s))
    return out
  }, [stats.byId])
  const deals = useMemo(() => dealsAhead(dealsQ.data ?? [], today, DEAL_AHEAD_DAYS), [dealsQ.data, today])
  const costsQ = useShopCosts()
  const store = useStoreLooks(items, watches, costsQ.data ?? NO_COSTS, today)
  const all = useMemo(() => needsALook(items, { watches, facts, deals, store: store.inputs }, today), [items, watches, facts, deals, store.inputs, today])
  // The server's notices (211: a plan bought a thing as a draft) are the bell's list, which the sheet shows after the
  // urgent rows (owner, 27.11.2026; the rows come sorted by tone); this reads the same query to count them and to wait for them.
  const noticesQ = useShopNotices()
  const { shown, hidden } = useMemo(() => splitLooks(all, statesQ.data ?? [], today), [all, statesQ.data, today])
  const loading = itemsLoading || noticesQ.isLoading || watchQ.isLoading || stats.loading || dealsQ.isLoading || statesQ.isLoading || costsQ.isLoading || store.loading
  const failed = (!itemsLoading && itemsQ.isError) || (!noticesQ.isLoading && noticesQ.isError) || (!watchQ.isLoading && watchQ.isError) || stats.failed
    || (!dealsQ.isLoading && dealsQ.isError) || (!statesQ.isLoading && statesQ.isError) || (!costsQ.isLoading && costsQ.isError) || store.failed
  const onRetry = () => {
    if (itemsQ.isError) void itemsQ.refetch()
    if (noticesQ.isError) void noticesQ.refetch()
    if (watchQ.isError) void watchQ.refetch()
    if (stats.failed) stats.refetch()
    if (dealsQ.isError) void dealsQ.refetch()
    if (statesQ.isError) void statesQ.refetch()
    if (costsQ.isError) void costsQ.refetch()
    if (store.failed) store.retry()
  }
  return { looks: shown, hidden, notices: noticesQ.data?.length ?? 0, loading, failed, onRetry }
}
