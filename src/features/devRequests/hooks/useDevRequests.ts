import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import {
  fetchDevRequests, createDevRequest, updateDevRequest, deleteDevRequest, deleteDevRequests, reorderDevRequests,
  setDevRequestsStatus, markDevRequestsPrompted,
} from '../api/devRequestsApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { applyReorder } from '../devRequestRules'
import type { DevRequest, CreateDevRequestInput, DevRequestStatus } from '../types'

const QK = qk.devRequests.all

// When the last full read of the list STARTED. An edit draft touched before
// then whose request is missing from that read belongs to a deleted request;
// one touched later may be for a request created since (setQueryData — the
// optimistic reorder — refreshes dataUpdatedAt without reading anything, so
// that can't be used for this).
let listReadFrom = 0
export const devRequestsReadFrom = () => listReadFrom

export function useDevRequests() {
  return useQuery({
    queryKey: QK,
    queryFn: async () => {
      const started = Date.now()
      const rows = await fetchDevRequests()
      listReadFrom = started
      return rows
    },
    staleTime: STALE.short,
  })
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

export function useSetDevRequestsStatus() {
  return useMutationWithFeedback({
    action:      'set_dev_requests_status',
    mutationFn:  ({ ids, status }: { ids: string[]; status: DevRequestStatus }) => setDevRequestsStatus(ids, status),
    invalidates: [QK],
  })
}

// Silent: a failure is still toasted and logged, but copying the prompt the
// user asked for never waits on or depends on this bookkeeping write.
export function useMarkDevRequestsPrompted() {
  return useMutationWithFeedback({
    action:      'mark_dev_requests_prompted',
    mutationFn:  (ids: string[]) => markDevRequestsPrompted(ids),
    invalidates: [QK],
  })
}

// Optimistic — reordering should feel instant; the mutation persists in the
// background and reconciles on settle. The changes cover the WHOLE list
// (planReorder): the old version replaced the cache with only the dragged,
// filtered rows, so done and filtered-out requests vanished until the refetch.
export function useReorderDevRequests() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'reorder_dev_requests',
    mutationFn: (changes: { id: string; sort_order: number }[]) => reorderDevRequests(changes),
    onMutate:   async (changes: { id: string; sort_order: number }[]) => {
      await qc.cancelQueries({ queryKey: QK })
      const previous = qc.getQueryData<DevRequest[]>(QK)
      if (previous) qc.setQueryData(QK, applyReorder(previous, changes))
      return { previous }
    },
    onError: (_err, _changes, mutateResult) => {
      const ctx = mutateResult as { previous?: DevRequest[] } | undefined
      if (ctx?.previous) qc.setQueryData(QK, ctx.previous)
    },
    invalidates: [QK],
  })
}
