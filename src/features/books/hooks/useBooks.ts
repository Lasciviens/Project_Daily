import { useQuery } from '@tanstack/react-query'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { cancelDelivery, deleteDeliveryRow, fetchDeliveries, sendPrepared, type PreparedBook } from '../api/booksApi'
import { fetchKoboSyncState } from '../api/libraryApi'
import type { BookDelivery } from '../types'

export function useDeliveries() {
  return useQuery({ queryKey: qk.books.deliveries(), queryFn: fetchDeliveries, staleTime: STALE.short })
}

export function useKoboFeedState(enabled = true) {
  return useQuery({ queryKey: qk.books.koboState(), queryFn: fetchKoboSyncState, staleTime: STALE.short, enabled })
}

export function useSendPrepared() {
  return useMutationWithFeedback({
    action: 'kobo_send_prepared',
    mutationFn: (p: PreparedBook) => sendPrepared(p),
    loadingMessage: 'Sending…',
    successMessage: d => `Sent “${d.title ?? d.filename}” — it lands on the Kobo at its next Wi-Fi sync`,
    invalidates: [qk.books.all],
  })
}

export function useCancelDelivery() {
  return useMutationWithFeedback({
    action: 'kobo_cancel',
    mutationFn: async (d: BookDelivery) => { await cancelDelivery(d); return true },
    silent: 'the delete flow reports the result',
    invalidates: [qk.books.all],
  })
}

/** A finished delivery's row: nothing to put back (its file is gone), so no Undo. */
export function useDeleteDeliveryRow() {
  return useMutationWithFeedback({
    action: 'kobo_delete_row',
    silent: 'the delete flow reports the result',
    mutationFn: async (id: string) => { await deleteDeliveryRow(id); return true },
    invalidates: [qk.books.all],
  })
}
