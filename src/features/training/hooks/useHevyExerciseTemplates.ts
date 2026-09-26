import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyExerciseTemplates } from '../api/hevyApi'

export function useHevyExerciseTemplates() {
  return useQuery({
    queryKey: qk.hevy.templates(),
    queryFn:  fetchHevyExerciseTemplates,
    staleTime: STALE.long,
  })
}
