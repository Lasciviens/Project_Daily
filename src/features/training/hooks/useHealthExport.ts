import { useQuery } from '@tanstack/react-query'
import { fetchHealthWorkouts, fetchHealthMetrics, fetchHealthMetricSeries } from '../api/healthApi'

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

// One metric's full point history within a date range — used by the
// dedicated chart sections (rings, steps, energy, heart, sleep, body).
export function useHealthMetricSeries(metricName: string, fromDate: string, toDate: string) {
  return useQuery({
    queryKey: ['health', 'metric-series', metricName, fromDate, toDate],
    queryFn:  () => fetchHealthMetricSeries(metricName, fromDate, toDate),
    staleTime: 5 * 60_000,
  })
}
