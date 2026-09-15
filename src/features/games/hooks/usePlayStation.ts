import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { fetchPsnStatus, connectPsn, disconnectPsn, fetchPsnProfile, fetchPsnTitles } from '../api/psnApi'

const STATUS_QK = ['psn', 'status']

export function usePsnStatus() {
  return useQuery({ queryKey: STATUS_QK, queryFn: fetchPsnStatus, staleTime: 60_000 })
}

export function usePsnProfile(enabled: boolean) {
  return useQuery({ queryKey: ['psn', 'profile'], queryFn: fetchPsnProfile, enabled, staleTime: 5 * 60_000, retry: false })
}

export function usePsnTitles(enabled: boolean) {
  return useQuery({ queryKey: ['psn', 'titles'], queryFn: fetchPsnTitles, enabled, staleTime: 5 * 60_000, retry: false })
}

export function useConnectPsn() {
  const qc = useQueryClient()
  return useMutationWithFeedback<{ connected: true; expiresAt: string }, string>({
    action: 'connect_psn',
    successMessage: 'PlayStation connected ✓',
    mutationFn: connectPsn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['psn'] }),
  })
}

export function useDisconnectPsn() {
  const qc = useQueryClient()
  return useMutationWithFeedback<void, void>({
    action: 'disconnect_psn',
    successMessage: 'PlayStation disconnected',
    mutationFn: disconnectPsn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['psn'] }),
  })
}
