import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyPRs, triggerInitialHevySync } from '../api/hevyApi'

export function useHevyPRs() {
  return useQuery({
    queryKey: qk.hevy.prs(),
    queryFn:  fetchHevyPRs,
    staleTime: STALE.long,
  })
}

// Same server-side task clean-up as the incremental sync, so the same
// invalidation (it used to refresh only ['hevy']).
export function useInitialHevySync() {
  return useMutationWithFeedback({
    action:         'hevy_initial_sync',
    loadingMessage: 'Syncing all Hevy data…',
    successMessage: (r: Awaited<ReturnType<typeof triggerInitialHevySync>>) => `Synced ${r.workouts} workouts`,
    mutationFn:     triggerInitialHevySync,
    invalidates:    [qk.hevy.all, 'taskGraph'],
  })
}
