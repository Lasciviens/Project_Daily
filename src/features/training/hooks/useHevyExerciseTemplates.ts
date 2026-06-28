import { useQuery } from '@tanstack/react-query'
import { fetchHevyExerciseTemplates } from '../api/hevyApi'

export function useHevyExerciseTemplates() {
  return useQuery({
    queryKey: ['hevy', 'templates'],
    queryFn:  fetchHevyExerciseTemplates,
    staleTime: 10 * 60_000,
  })
}
