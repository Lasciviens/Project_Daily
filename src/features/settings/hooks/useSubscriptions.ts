import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { createSubscription, fetchSubscriptions, updateSubscription } from '../api/subscriptionsApi'
import type { SubscriptionInput } from '../subscriptionRules'
import { useCurrencyRates } from '../../home/hooks/useCurrencyRates'

export function useSubscriptions() {
  return useQuery({ queryKey: qk.subscriptions.list(), queryFn: fetchSubscriptions, staleTime: STALE.default })
}

export function useSaveSubscription() {
  return useMutationWithFeedback({
    action: 'save_subscription',
    successMessage: 'Subscription saved',
    mutationFn: ({ id, input }: { id?: string; input: SubscriptionInput }) => (id ? updateSubscription(id, input) : createSubscription(input)),
    invalidates: [qk.subscriptions.all],
  })
}

export function useDeleteSubscription() {
  return useRowsDelete({ table: 'service_subscriptions', action: 'delete_subscription', invalidates: [qk.subscriptions.all], cache: qk.subscriptions.all })
}

/**
 * Open Exchange Rates (X per 1 USD) for converting subscription prices —
 * the Home currency widget's own query and cache (one hour, no focus
 * refetch), so Settings adds no extra API calls. Null until loaded or when
 * the rates can't be fetched (no OXR key, offline); callers then show
 * prices in their own currency only.
 */
export function useSubscriptionRates(enabled = true): { rates: Record<string, number> | null; date: string | null; failed: boolean } {
  const q = useCurrencyRates({ enabled })
  return { rates: q.data?.rawRates ?? null, date: q.data?.date ?? null, failed: q.isError }
}
