import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchPricePoints, fetchPriceWatches } from '../api/shopApi'
import { checkItemPrices, type PriceCheckOutcome } from '../api/shopPriceApi'
import { checkToast } from '../watchWords'
import type { ShopPriceWatch } from '../types'

// The price watch (shop-price, migration 137). Grocery prices (Kassalapp): useGrocery.ts.

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
 * "Check now": re-reads the links (or answers with the check from the last
 * hour, said so). A price is the result; a site's answer without one — a bot
 * check, no price — is a warning in its words (`checkToast`); a failed check
 * is an error with the reason (the watch still records it, and shop-price
 * never answers a failure from the last hour, so a second tap tries again).
 * Several links report a count.
 */
export function useCheckPrices() {
  return useMutationWithFeedback({
    action:         'check_shop_prices',
    loadingMessage: 'Checking the price…',
    successMessage: (r: PriceCheckOutcome[]) => {
      const t = checkToast(r)
      return t.tone === 'success' ? t.text : undefined
    },
    onSuccess:      (r: PriceCheckOutcome[]) => {
      const t = checkToast(r)
      if (t.tone === 'warning') toast.warning(t.text)
    },
    mutationFn:     async (ids: string[]) => {
      const r = await checkItemPrices(ids)
      if (r.length === 1 && r[0].status === 'error') throw new Error(r[0].error ?? 'Couldn\'t check the price')
      return r
    },
    // A check adds a point: the record's history and every list of price figures (usePriceStats) read it.
    invalidates:    (_d, ids) => [qk.shop.watches(), qk.shop.priceStatsAll, ...ids.map(id => qk.shop.points(id))],
  })
}

/** A check in the background (a link just saved): no toasts; the watch fills in when it is done. */
export function useQuietCheck() {
  const qc = useQueryClient()
  return (ids: string[]) => {
    if (!ids.length) return
    checkItemPrices(ids)
      .then(() => Promise.all([qc.invalidateQueries({ queryKey: qk.shop.watches() }), qc.invalidateQueries({ queryKey: qk.shop.priceStatsAll })]))
      .catch((e: Error) => logError(`shop_quiet_check: ${e.message}`, { action: 'shop_quiet_check' }))
  }
}
