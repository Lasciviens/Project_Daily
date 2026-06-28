import { useQuery } from '@tanstack/react-query'
import { fetchBodyMeasurements } from '../api/hevyApi'

export function useHevyBodyMeasurements(limit?: number) {
  return useQuery({
    queryKey: ['hevy', 'measurements', limit],
    queryFn:  () => fetchBodyMeasurements(limit),
    staleTime: 5 * 60_000,
  })
}
