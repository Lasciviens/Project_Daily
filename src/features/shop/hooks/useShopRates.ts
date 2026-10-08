import { useCurrencyRates } from '../../home/hooks/useCurrencyRates'
import type { UsdRates } from '../../settings/subscriptionRules'

/** Exchange rates for Shop's totals — Home's currency query, so no extra request. */
export function useShopRates(enabled = true): { rates: UsdRates | null; date: string | null; failed: boolean } {
  const q = useCurrencyRates({ enabled })
  return { rates: q.data?.rawRates ?? null, date: q.data?.date ?? null, failed: q.isError }
}
