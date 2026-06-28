import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchBodyMeasurements, callHevyApi } from '../api/hevyApi'
import { toast } from '../../../app/store'
import { logError } from '../../../shared/utils/logError'

export function useHevyBodyMeasurements(limit?: number) {
  return useQuery({
    queryKey: ['hevy', 'measurements', limit],
    queryFn:  () => fetchBodyMeasurements(limit),
    staleTime: 5 * 60_000,
  })
}

export function useUpsertBodyMeasurement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: unknown) => callHevyApi('upsert_body_measurement', payload),
    onMutate: () => toast.loading('Saving measurement…'),
    onSuccess: (_data, _vars, tid) => {
      qc.invalidateQueries({ queryKey: ['hevy', 'measurements'] })
      toast.dismiss(tid as string)
      toast.success('Measurement saved ✓')
    },
    onError: (err, _vars, tid) => {
      toast.dismiss(tid as string)
      const msg = (err as Error).message ?? 'Failed to save measurement'
      toast.error(msg)
      logError(`Body measurement save failed: ${msg}`)
    },
  })
}
