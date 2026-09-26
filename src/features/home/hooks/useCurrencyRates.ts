import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchCurrencyData } from '../api/currencyApi'

/**
 * NOK⇄TRY, EUR⇄USD and gold. Each fetch costs TWO Open Exchange Rates calls
 * (latest + historical) against a 1000/month free tier, so it is cached for an
 * hour and never refetched on window focus / PWA foreground — the old
 * `staleTime: 0` spent two calls on every focus.
 */
export function useCurrencyRates({ enabled = true, refetchInterval = false }: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: qk.external.currency(),
    queryFn:  fetchCurrencyData,
    staleTime: STALE.hour,
    refetchOnWindowFocus: false,
    refetchInterval,
    enabled,
  })
}
