import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyAccountStatus, fetchHevySyncState, syncMissingHevyWorkouts, triggerIncrementalHevySync, triggerInitialHevySync } from '../api/hevyApi'
import { missingWorkoutsMessage } from '../hevyAccountModel'

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

/** The Hevy account (user info, Hevy's workout count) and the stored
 *  workouts that count is compared with — the Hevy card on Subscriptions. */
export function useHevyAccountStatus() {
  return useQuery({
    queryKey: qk.hevy.account(),
    queryFn:  fetchHevyAccountStatus,
    staleTime: STALE.default,
  })
}

/** Reads every page of Hevy's workout list and stores the ones missing here
 *  (the Hevy card's button when the counts differ). New workouts can close
 *  planned sessions (migration 141), so the task graph refreshes too. */
export function useFetchMissingHevyWorkouts() {
  return useMutationWithFeedback({
    action:         'hevy_sync_missing_workouts',
    loadingMessage: 'Reading every workout in Hevy…',
    successMessage: missingWorkoutsMessage,
    mutationFn:     syncMissingHevyWorkouts,
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
