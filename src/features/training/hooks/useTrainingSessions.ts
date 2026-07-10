import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchStravaStatus } from '../api/trainingApi'
import { syncStravaActivities, disconnectStrava } from '../api/stravaApi'

export function useStravaStatus() {
  return useQuery({
    queryKey: ['training', 'strava-status'],
    queryFn:  fetchStravaStatus,
    staleTime: 60 * 60_000,
  })
}

export function useSyncStrava() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: syncStravaActivities,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['training'] }),
  })
}

export function useDisconnectStrava() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: disconnectStrava,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['training'] }),
  })
}
