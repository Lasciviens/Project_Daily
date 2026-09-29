import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { createSubscription, deleteSubscription, fetchSubscriptions, updateSubscription } from '../api/subscriptionsApi'
import type { SubscriptionInput } from '../subscriptionRules'

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
  return useMutationWithFeedback({
    action: 'delete_subscription',
    successMessage: 'Subscription removed',
    mutationFn: (id: string) => deleteSubscription(id),
    invalidates: [qk.subscriptions.all],
  })
}
