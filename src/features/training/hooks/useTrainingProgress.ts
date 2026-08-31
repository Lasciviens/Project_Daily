import { useQuery } from '@tanstack/react-query'
import { fetchTrainingHistory, fetchBodyweightHistory } from '../api/hevyApi'

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

// Same window as useTrainingHistory — feeds the Relative Strength chart's
// bodyweight-resolution ladder (progressAggregate.ts's resolveBodyweightForDate).
export function useBodyweightHistory() {
  const to = new Date()
  const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000)
  const toStr = to.toISOString().slice(0, 10)
  const fromStr = from.toISOString().slice(0, 10)
  return useQuery({
    queryKey: ['hevy', 'bodyweight-history', fromStr, toStr],
    queryFn:  () => fetchBodyweightHistory(fromStr, toStr),
    staleTime: 10 * 60_000,
  })
}
