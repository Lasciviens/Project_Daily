import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import {
  fetchDevRequests, createDevRequest, updateDevRequest, deleteDevRequest, deleteDevRequests, reorderDevRequests,
} from '../api/devRequestsApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type { DevRequest, CreateDevRequestInput } from '../types'

const QK = qk.devRequests.all

export function useDevRequests() {
  return useQuery({ queryKey: QK, queryFn: fetchDevRequests, staleTime: STALE.short })
}

export function useCreateDevRequest() {
  return useMutationWithFeedback({
    action:         'create_dev_request',
    successMessage: 'Added',
    mutationFn:     (input: CreateDevRequestInput) => createDevRequest(input),
    invalidates:    [QK],
  })
}

export function useUpdateDevRequest() {
  return useMutationWithFeedback({
    action:     'update_dev_request',
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateDevRequest>[1] }) => updateDevRequest(id, patch),
    invalidates: [QK],
  })
}

export function useDeleteDevRequest() {
  return useMutationWithFeedback({
    action:         'delete_dev_request',
    successMessage: 'Deleted',
    mutationFn:     (id: string) => deleteDevRequest(id),
    invalidates:    [QK],
  })
}

export function useBulkDeleteDevRequests() {
  return useMutationWithFeedback({
    action:         'bulk_delete_dev_requests',
    successMessage: 'Deleted',
    mutationFn:     (ids: string[]) => deleteDevRequests(ids),
    invalidates:    [QK],
  })
}

// Optimistic — reordering should feel instant; the mutation persists in the
// background and reconciles on settle.
export function useReorderDevRequests() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'reorder_dev_requests',
    mutationFn: (ids: string[]) => reorderDevRequests(ids),
    onMutate:   async (ids: string[]) => {
      await qc.cancelQueries({ queryKey: QK })
      const previous = qc.getQueryData<DevRequest[]>(QK)
      if (previous) {
        const byId = new Map(previous.map(r => [r.id, r]))
        qc.setQueryData(QK, ids.map((id, i) => ({ ...byId.get(id)!, sort_order: i })))
      }
      return { previous }
    },
    onError: (_err, _ids, mutateResult) => {
      const ctx = mutateResult as { previous?: DevRequest[] } | undefined
      if (ctx?.previous) qc.setQueryData(QK, ctx.previous)
    },
    invalidates: [QK],
  })
}
