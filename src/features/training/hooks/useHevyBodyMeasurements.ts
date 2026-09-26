import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { fetchBodyMeasurements, callHevyApi } from '../api/hevyApi'

export function useHevyBodyMeasurements(limit?: number) {
  return useQuery({
    queryKey: qk.hevy.measurements(limit),
    queryFn:  () => fetchBodyMeasurements(limit),
    staleTime: STALE.default,
  })
}

export function useUpsertBodyMeasurement() {
  return useMutationWithFeedback({
    action:         'upsert_body_measurement',
    loadingMessage: 'Saving measurement…',
    successMessage: 'Measurement saved',
    mutationFn:     (payload: unknown) => callHevyApi('upsert_body_measurement', payload),
    invalidates:    [qk.hevy.measurementsAll],
  })
}
