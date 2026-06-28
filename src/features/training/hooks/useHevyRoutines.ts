import { useQuery } from '@tanstack/react-query'
import { fetchHevyRoutines } from '../api/hevyApi'

export function useHevyRoutines() {
  return useQuery({
    queryKey: ['hevy', 'routines'],
    queryFn:  fetchHevyRoutines,
    staleTime: 5 * 60_000,
  })
}
