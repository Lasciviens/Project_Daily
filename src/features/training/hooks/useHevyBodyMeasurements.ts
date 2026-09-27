import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchBodyMeasurements, fetchBodyMeasurementForDate, callHevyApi } from '../api/hevyApi'

export function useHevyBodyMeasurements(limit?: number) {
  return useQuery({
    queryKey: qk.hevy.measurements(limit),
    queryFn:  () => fetchBodyMeasurements(limit),
    staleTime: STALE.default,
  })
}

/** What is stored for one date, read fresh (the form shows exactly what a
 *  save will keep or replace). */
export function useHevyBodyMeasurementForDate(date: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.hevy.measurementForDate(date),
    queryFn:  () => fetchBodyMeasurementForDate(date),
    staleTime: STALE.live,
    enabled:  enabled && !!date,
    placeholderData: keepPreviousData,
  })
}

// hevy_body_measurements is one of the bodyweight series' sources, so a save
// refreshes the merged series (qk.health.bodyweightAll — Health, Progress,
// the nutrition coach) and the rest of Health along with the measurement list.
export function useUpsertBodyMeasurement() {
  return useMutationWithFeedback({
    action:         'upsert_body_measurement',
    loadingMessage: 'Saving measurement…',
    successMessage: 'Measurement saved',
    mutationFn:     (payload: Record<string, unknown>) => callHevyApi('upsert_body_measurement', payload),
    invalidates:    [qk.hevy.all, qk.health.bodyweightAll, qk.health.all],
  })
}
