import { useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchHealthWorkouts, fetchHealthMetrics, fetchHealthMetricSeries, upsertManualSleepEntry, type ManualSleepInput } from '../api/healthApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'

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
export function useHealthMetricSeries(
  metricName: string,
  fromDate: string,
  toDate: string,
) {
  return useQuery({
    queryKey: ['health', 'metric-series', metricName, fromDate, toDate],
    queryFn:  () => fetchHealthMetricSeries(metricName, fromDate, toDate),
    staleTime: 5 * 60_000,
  })
}

// Logs a night the Watch wasn't worn for (or corrects an existing manual
// entry) as source: 'manual' — see upsertManualSleepEntry for the
// Deep/Core/REM split + upsert-not-insert logic.
export function useAddManualSleep() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action:         'add_manual_sleep',
    successMessage: 'Sleep entry saved ✓',
    mutationFn:     (input: ManualSleepInput) => upsertManualSleepEntry(input),
    onSuccess:      () => qc.invalidateQueries({ queryKey: ['health', 'metric-series', 'sleep_analysis'] }),
  })
}
