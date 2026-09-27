import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyWorkouts, fetchHevyWorkoutsInRange, fetchHevyWorkoutDetail, callHevyApi } from '../api/hevyApi'

/** A page of workouts, newest performed first (start_time). */
export function useHevyWorkouts(opts: {
  limit?: number
  offset?: number
  from?: string
  to?: string
  includeExercises?: boolean
} = {}) {
  return useQuery({
    queryKey: qk.hevy.workouts(opts),
    queryFn:  () => fetchHevyWorkouts(opts),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
  })
}

/** How many recent workouts "recent" means everywhere (last trained, Daily,
 *  Home, the coach) — one shared limit so they share one cached request. */
export const RECENT_WORKOUTS_LIMIT = 50

export function useRecentHevyWorkouts() {
  return useHevyWorkouts({ limit: RECENT_WORKOUTS_LIMIT })
}

/** Every workout performed on the local days [from, to] ('yyyy-MM-dd'). */
export function useHevyWorkoutsRange(from: string, to: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.hevy.workoutsRange(from, to),
    queryFn:  () => fetchHevyWorkoutsInRange(from, to),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled,
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

// Payload comes from routineForm.workoutFormToPayload (the strict Hevy shape).
export function useLogHevyWorkout() {
  return useMutationWithFeedback({
    action:         'create_workout',
    loadingMessage: 'Saving workout…',
    successMessage: 'Workout logged',
    mutationFn:     (payload: unknown) => callHevyApi('create_workout', payload),
    invalidates:    ['training'],
  })
}
