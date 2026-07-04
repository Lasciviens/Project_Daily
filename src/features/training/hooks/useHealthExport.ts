import { useQuery } from '@tanstack/react-query'
import { fetchHealthWorkouts, fetchHealthMetrics } from '../api/healthApi'

export function useHealthWorkouts(opts: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ['health', 'workouts', opts],
    queryFn:  () => fetchHealthWorkouts(opts),
    staleTime: 5 * 60_000,
  })
}

export function useHealthMetrics(opts: { limit?: number } = {}) {
  return useQuery({
    queryKey: ['health', 'metrics', opts],
    queryFn:  () => fetchHealthMetrics(opts),
    staleTime: 5 * 60_000,
  })
}
