import { useQuery } from '@tanstack/react-query'
import { qk } from '../../../shared/query/keys'
import { STALE } from '../../../shared/query/stale'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { cancelDelivery, deleteDeliveryRow, fetchDeliveries, sendPrepared, sendToKobo, type PreparedBook } from '../api/booksApi'
import { fetchKoboSyncState } from '../api/libraryApi'
import type { BookDelivery } from '../types'

export function useDeliveries() {
  return useQuery({ queryKey: qk.books.deliveries(), queryFn: fetchDeliveries, staleTime: STALE.short })
}

export function useKoboFeedState(enabled = true) {
  return useQuery({ queryKey: qk.books.koboState(), queryFn: fetchKoboSyncState, staleTime: STALE.short, enabled })
}

export function useSendToKobo() {
  return useMutationWithFeedback({
    action: 'kobo_send',
    mutationFn: (file: File) => sendToKobo(file),
    loadingMessage: 'Uploading…',
    successMessage: d => `Sent “${d.filename}” — it lands on the Kobo at its next Wi-Fi sync`,
    invalidates: [qk.books.all],
  })
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
    mutationFn: (d: BookDelivery) => cancelDelivery(d),
    successMessage: 'Removed from the Kobo inbox',
    invalidates: [qk.books.all],
  })
}

export function useDeleteDeliveryRow() {
  return useMutationWithFeedback({
    action: 'kobo_delete_row',
    mutationFn: (id: string) => deleteDeliveryRow(id),
    invalidates: [qk.books.all],
  })
}
