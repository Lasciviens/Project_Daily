import { useQuery } from '@tanstack/react-query'
import { fetchHealthWorkouts, fetchHealthMetrics } from '../api/healthApi'

export function useHealthWorkouts(opts: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ['health', 'workouts', opts],
    queryFn:  () => fetchHealthWorkouts(opts),
    staleTime: 5 * 60_000,
  })
}

export function useHealthMetric(
  metricName: string,
  opts: { from?: string; to?: string; limit?: number } = {},
) {
  return useQuery({
    queryKey: ['health', 'metric', metricName, opts],
    queryFn:  () => fetchHealthMetrics(metricName, opts),
    staleTime: 5 * 60_000,
  })
}
