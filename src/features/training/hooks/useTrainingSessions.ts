import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchStravaStatus } from '../api/trainingApi'
import { syncStravaActivities, disconnectStrava } from '../api/stravaApi'

export function useStravaStatus() {
  return useQuery({
    // TODO(qk): move to a qk.training.stravaStatus() builder.
    queryKey: [...qk.training.all, 'strava-status'] as const,
    queryFn:  fetchStravaStatus,
    staleTime: STALE.hour,
  })
}

// Activities live under ['strava', …] and the connection status under
// ['training', …] — invalidating only ['training'] (the old behaviour) left
// every Strava list stale after a sync, connect or disconnect.
const STRAVA_TARGETS = [qk.strava.all, qk.training.all] as const

export function useSyncStrava() {
  return useMutationWithFeedback({
    action:         'sync_strava',
    loadingMessage: 'Syncing Strava activities…',
    successMessage: (data: Awaited<ReturnType<typeof syncStravaActivities>>) => `Synced ${data.synced} activities from Strava`,
    mutationFn:     syncStravaActivities,
    invalidates:    STRAVA_TARGETS,
  })
}

export function useDisconnectStrava() {
  return useMutationWithFeedback({
    action:         'disconnect_strava',
    loadingMessage: 'Disconnecting Strava…',
    successMessage: 'Strava disconnected',
    mutationFn:     disconnectStrava,
    invalidates:    STRAVA_TARGETS,
  })
}

/** Refresh target for StravaWidget's OAuth-callback connect. */
export const STRAVA_INVALIDATE = STRAVA_TARGETS
