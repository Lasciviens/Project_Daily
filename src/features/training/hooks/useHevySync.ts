import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevySyncState, triggerIncrementalHevySync, triggerInitialHevySync } from '../api/hevyApi'

/** The events-feed cursor: when the last incremental sync ran. */
export function useHevySyncState() {
  return useQuery({
    queryKey: qk.hevy.syncCursor(),
    queryFn:  fetchHevySyncState,
    staleTime: STALE.live,
  })
}

// A sync can add workouts, re-read body measurements (the bodyweight series)
// and prune routines the current program points at; a workout logged from a
// routine also deletes its planned-session task (and block) server-side. So
// both syncs refresh every training view plus the task graph.
export function useIncrementalHevySync() {
  return useMutationWithFeedback({
    action:         'hevy_incremental_sync',
    successMessage: (r: Awaited<ReturnType<typeof triggerIncrementalHevySync>>) => `Synced: +${r.updated} updated, ${r.deleted} deleted`,
    mutationFn:     triggerIncrementalHevySync,
    invalidates:    ['training', 'taskGraph'],
  })
}

export function useInitialHevySync() {
  return useMutationWithFeedback({
    action:         'hevy_initial_sync',
    loadingMessage: 'Syncing all Hevy data…',
    successMessage: (r: Awaited<ReturnType<typeof triggerInitialHevySync>>) => `Synced ${r.workouts} workouts`,
    mutationFn:     triggerInitialHevySync,
    invalidates:    ['training', 'taskGraph'],
  })
}
