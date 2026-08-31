import { useQuery } from '@tanstack/react-query'
import { fetchTrainingHistory } from '../api/hevyApi'

// 6-month window — long enough to show a real trend, short enough that the
// paginated hevy_sets fetch (fetchMuscleVolume's own precedent) stays cheap.
const WINDOW_DAYS = 182

export function useTrainingHistory() {
  const to = new Date()
  const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000)
  return useQuery({
    queryKey: ['hevy', 'training-history', from.toISOString().slice(0, 10)],
    queryFn:  () => fetchTrainingHistory(from.toISOString(), to.toISOString()),
    staleTime: 10 * 60_000,
  })
}
