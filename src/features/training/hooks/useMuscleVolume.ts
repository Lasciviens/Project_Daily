import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchMuscleVolume } from '../api/hevyApi'

export function useMuscleVolume(fromIso: string, toIso: string, enabled = true) {
  return useQuery({
    queryKey: qk.hevy.muscleVolume(fromIso, toIso),
    queryFn:  () => fetchMuscleVolume(fromIso, toIso),
    staleTime: STALE.default,
    enabled,
  })
}
