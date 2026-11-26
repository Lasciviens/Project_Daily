import { useMemo } from 'react'
import { todayStr } from '../../../shared/utils/dateUtils'
import { useShopItems } from './useShop'
import { useShopWatches } from './useShopPrices'
import { useDealDays, usePriceStats, useSignalStates } from './useShopSignals'
import { useShopCosts } from './useShopMoney'
import { useStoreLooks } from './useStoreLooks'
import { dealsAhead } from '../dealDays'
import { DEAL_AHEAD_DAYS, needsALook, noticeLooks, splitLooks, type Look } from '../shopSuggestions'
import { useShopNotices } from './useShopNotices'
import { factsOf, watchedWishIds, type PriceFacts } from '../wishTile'
import type { ShopItem } from '../types'

const NO_COSTS: never[] = []

export interface NeedsALookData { looks: Look[]; hidden: Look[]; loading: boolean; failed: boolean; onRetry: () => void }

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
  // The server's notices (211: a plan bought a thing as a draft) after the urgent rows; they are read, never snoozed.
  const noticesQ = useShopNotices()
  const notices = useMemo(() => noticeLooks(noticesQ.data ?? [], items), [noticesQ.data, items])
  const split = useMemo(() => splitLooks(all, statesQ.data ?? [], today), [all, statesQ.data, today])
  const shown = useMemo(() => {
    const urgent = split.shown.filter(l => l.tone === 'danger' || l.tone === 'warn')
    return [...urgent, ...notices, ...split.shown.filter(l => !urgent.includes(l))]
  }, [notices, split.shown])
  const hidden = split.hidden
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
  return { looks: shown, hidden, loading, failed, onRetry }
}
