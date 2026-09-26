import { useQuery } from '@tanstack/react-query'
import { fetchHealthWorkouts, fetchHealthMetrics, fetchHealthMetricSeries, upsertManualSleepEntry, type ManualSleepInput } from '../api/healthApi'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'

export function useHealthWorkouts(opts: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: qk.health.workouts(opts),
    queryFn:  () => fetchHealthWorkouts(opts),
    staleTime: STALE.default,
  })
}

export function useHealthMetrics(opts: { limit?: number } = {}) {
  return useQuery({
    queryKey: qk.health.metrics(opts),
    queryFn:  () => fetchHealthMetrics(opts),
    staleTime: STALE.default,
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
    queryKey: qk.health.metricSeries(metricName, fromDate, toDate),
    queryFn:  () => fetchHealthMetricSeries(metricName, fromDate, toDate),
    staleTime: STALE.default,
  })
}

// Logs a night the Watch wasn't worn for (or corrects an existing manual
// entry) as source: 'manual' — see upsertManualSleepEntry for the
// Deep/Core/REM split + upsert-not-insert logic.
export function useAddManualSleep() {
  return useMutationWithFeedback({
    action:         'add_manual_sleep',
    successMessage: 'Sleep entry saved',
    mutationFn:     (input: ManualSleepInput) => upsertManualSleepEntry(input),
    invalidates:    [qk.health.metricSeriesAll('sleep_analysis')],
  })
}
