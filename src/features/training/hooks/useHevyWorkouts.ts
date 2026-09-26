import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyWorkouts, fetchHevyWorkoutDetail, triggerIncrementalHevySync, callHevyApi } from '../api/hevyApi'

export function useHevyWorkouts(opts: {
  limit?: number
  offset?: number
  from?: string
  to?: string
} = {}) {
  return useQuery({
    queryKey: qk.hevy.workouts(opts),
    queryFn:  () => fetchHevyWorkouts(opts),
    staleTime: STALE.default,
  })
}

export function useHevyWorkoutDetail(id: string | null) {
  return useQuery({
    queryKey: qk.hevy.workout(id ?? ''),
    queryFn:  () => fetchHevyWorkoutDetail(id!),
    enabled:  !!id,
    staleTime: STALE.long,
  })
}

// A synced workout logged from a routine deletes its matching training-session
// task (and its linked block) server-side, so task and schedule views refresh
// too — for both the incremental and the full sync.
export function useIncrementalHevySync() {
  return useMutationWithFeedback({
    action:         'hevy_incremental_sync',
    successMessage: (r: Awaited<ReturnType<typeof triggerIncrementalHevySync>>) => `Synced: +${r.updated} updated, ${r.deleted} deleted`,
    mutationFn:     triggerIncrementalHevySync,
    invalidates:    [qk.hevy.all, 'taskGraph'],
  })
}

export function useLogHevyWorkout() {
  return useMutationWithFeedback({
    action:         'create_workout',
    loadingMessage: 'Saving workout…',
    successMessage: 'Workout logged',
    mutationFn:     (payload: unknown) => callHevyApi('create_workout', payload),
    invalidates:    [qk.hevy.all],
  })
}
