import { useQuery, useQueryClient } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import {
  fetchDevRequests, createDevRequest, updateDevRequest, reorderDevRequests,
  setDevRequestsStatus, markDevRequestsPrompted,
} from '../api/devRequestsApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
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
    // The next request's place (topSortOrder) is read from this list.
    refresh:        'wait',
  })
}

export function useUpdateDevRequest() {
  return useMutationWithFeedback({
    action:     'update_dev_request',
    successMessage: (_r, { patch }) => (Object.keys(patch).length === 1 && patch.status
      ? (patch.status === 'done' ? 'Request done' : patch.status === 'dismissed' ? 'Request dismissed' : patch.status === 'in_progress' ? 'Request in progress' : 'Request reopened')
      : 'Request saved'),
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateDevRequest>[1] }) => updateDevRequest(id, patch),
    invalidates: [QK],
  })
}

/** One or several requests, with Undo (single and bulk deletes are the same call). */
export function useDeleteDevRequests() {
  return useRowsDelete({ table: 'dev_requests', action: 'delete_dev_requests', invalidates: [QK], cache: QK })
}

export function useSetDevRequestsStatus() {
  return useMutationWithFeedback({
    action:      'set_dev_requests_status',
    successMessage: (_r, { ids, status }) => `${ids.length} request${ids.length === 1 ? '' : 's'} ${status === 'done' ? 'done' : status === 'dismissed' ? 'dismissed' : 'updated'}`,
    mutationFn:  ({ ids, status }: { ids: string[]; status: DevRequestStatus }) => setDevRequestsStatus(ids, status),
    invalidates: [QK],
  })
}

// Silent: a failure is still toasted and logged, but copying the prompt the
// user asked for never waits on or depends on this bookkeeping write.
export function useMarkDevRequestsPrompted() {
  return useMutationWithFeedback({
    action:      'mark_dev_requests_prompted',
    silent:      'bookkeeping behind Copy, which reports itself',
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
    successMessage: 'Order saved',
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

// A point reviewed on a card (or on a saved request in the composer):
// written at once, and optimistic so the state flips on the tap.
export function useSetDevRequestDescription() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:     'review_dev_request_point',
    silent:     'a tap on a point: the point itself flips at once',
    mutationFn: ({ id, description }: { id: string; description: string }) => updateDevRequest(id, { description }),
    onMutate:   async ({ id, description }: { id: string; description: string }) => {
      await qc.cancelQueries({ queryKey: QK })
      const previous = qc.getQueryData<DevRequest[]>(QK)
      if (previous) qc.setQueryData(QK, previous.map(r => (r.id === id ? { ...r, description } : r)))
      return { previous }
    },
    onError: (_err, _vars, mutateResult) => {
      const ctx = mutateResult as { previous?: DevRequest[] } | undefined
      if (ctx?.previous) qc.setQueryData(QK, ctx.previous)
    },
    invalidates: [QK],
  })
}
