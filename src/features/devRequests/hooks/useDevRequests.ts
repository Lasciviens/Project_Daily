import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchDevRequests, createDevRequest, updateDevRequest, deleteDevRequest, reorderDevRequests,
} from '../api/devRequestsApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import type { DevRequest, CreateDevRequestInput } from '../types'

const QK = ['dev-requests'] as const

export function useDevRequests() {
  return useQuery({ queryKey: QK, queryFn: fetchDevRequests, staleTime: 30_000 })
}

export function useCreateDevRequest() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'create_dev_request',
    successMessage: 'Added ✓',
    mutationFn:     (input: CreateDevRequestInput) => createDevRequest(input),
    onSuccess:      () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useUpdateDevRequest() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'update_dev_request',
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateDevRequest>[1] }) => updateDevRequest(id, patch),
    onSuccess:  () => qc.invalidateQueries({ queryKey: QK }),
  })
}

export function useDeleteDevRequest() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'delete_dev_request',
    successMessage: 'Deleted',
    mutationFn:     (id: string) => deleteDevRequest(id),
    onSuccess:      () => qc.invalidateQueries({ queryKey: QK }),
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
    onSettled: () => qc.invalidateQueries({ queryKey: QK }),
  })
}
