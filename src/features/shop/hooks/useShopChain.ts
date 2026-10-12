import { useMemo } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { saveShopChain } from '../api/shopApi'
import { fetchDayRates } from '../api/shopPriceApi'
import { rateKey, ratePairs, type ChainDraft, type Copied, type RatePair } from '../chainDraft'
import { SHOP_ROWS } from './useShop'
import { useFillRatesNow } from './useShopMoney'

// The chain builder (owner, 12.10.2026): the past days' NOK rates its live
// numbers need, and the one-call save.

/** Norges Bank's rate of each (currency, day) the draft needs, by rateKey; a missing one reads "rate pending". */
export function useDayRates(pairs: readonly RatePair[]): { rates: ReadonlyMap<string, number>; loading: boolean } {
  const key = pairs.map(p => rateKey(p.currency, p.day)).join(',')
  const q = useQuery({
    queryKey:        qk.shop.dayRates(key),
    queryFn:         () => fetchDayRates(pairs),
    enabled:         pairs.length > 0,
    staleTime:       STALE.day,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
  })
  const rates = useMemo(() => new Map(Object.entries(q.data ?? {})), [q.data])
  return { rates, loading: q.isFetching }
}

/** The whole chain in one transaction; the rates it waits for are asked for straight after. */
export function useSaveShopChain() {
  const fill = useFillRatesNow()
  return useMutationWithFeedback({
    action:         'save_shop_chain',
    loadingMessage: 'Saving the chain…',
    successMessage: (_d: void, { draft }: { draft: ChainDraft; base: Copied | null; today: string }) =>
      `Saved · ${draft.steps.length} thing${draft.steps.length === 1 ? '' : 's'}`,
    mutationFn:     ({ draft, base, today }: { draft: ChainDraft; base: Copied | null; today: string }) => saveShopChain(draft, base, today),
    invalidates:    SHOP_ROWS,
    onSuccess:      (_d, { draft, base }) => { if (ratePairs(draft, base).length) fill() },
  })
}
