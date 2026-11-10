import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchShopStores, fetchStoreRules } from '../api/shopStoresApi'
import type { storeLooks as StoreLooksFn } from '../storeLooks'
import type { StoreLookInputs } from '../shopSuggestions'
import type { ShopItem, ShopItemCost, ShopPriceWatch } from '../types'

// The stores' part of Needs a look (price protection, money got back, price match) lives in its own chunk with
// storeRules: asked for once, by the first Needs a look that opens, while its reads are still out.

let loaded: typeof StoreLooksFn | null = null
let pending: Promise<void> | null = null
let chunkFailed = false

function load(): Promise<void> {
  pending ??= import('../storeLooks')
    .then(m => { loaded = m.storeLooks; chunkFailed = false })
    .catch(() => { chunkFailed = true; pending = null })
  return pending
}

const NO_LAW: never[] = []

/**
 * Needs a look's store rows from the stores and their rules (migration 191): undefined while they or the chunk
 * are on their way, so the list waits for them (nothing pops in under a drawn row); `failed` when one of them
 * can't be had — one line with Try again, never rows quietly left out.
 */
export function useStoreLooks(items: readonly ShopItem[], watches: ReadonlyMap<string, ShopPriceWatch>, costs: readonly ShopItemCost[], today: string) {
  const storesQ = useQuery({ queryKey: qk.shop.stores(), queryFn: fetchShopStores, staleTime: STALE.default })
  const rulesQ = useQuery({ queryKey: qk.shop.storeRules(), queryFn: fetchStoreRules, staleTime: STALE.default })
  const [, settled] = useState(0)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (loaded) return
    let live = true
    void load().then(() => { if (live) settled(n => n + 1) })
    return () => { live = false }
  }, [attempt])
  const fn = loaded
  const inputs = useMemo<StoreLookInputs | undefined>(() => (fn && storesQ.data && rulesQ.data
    ? fn({ items, watches, costs, ctx: { stores: storesQ.data, rules: rulesQ.data, law: NO_LAW }, now: new Date().toISOString(), today })
    : undefined), [fn, storesQ.data, rulesQ.data, items, watches, costs, today])
  const failed = (!storesQ.isLoading && storesQ.isError) || (!rulesQ.isLoading && rulesQ.isError) || (!fn && chunkFailed)
  return {
    inputs,
    loading: !failed && !inputs,
    failed,
    retry: () => {
      if (storesQ.isError) void storesQ.refetch()
      if (rulesQ.isError) void rulesQ.refetch()
      if (!fn) setAttempt(n => n + 1)
    },
  }
}
