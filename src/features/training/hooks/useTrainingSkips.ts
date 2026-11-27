import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { useTodayStr } from '../../../shared/hooks/useToday'
import { fetchTrainingSkips } from '../api/trainingSkipsApi'
import { skipsFromWeek } from '../plan/skippedRoutines'

export function useTrainingSkips() {
  const fromWeek = skipsFromWeek(useTodayStr())
  return useQuery({ queryKey: qk.training.skips(fromWeek), queryFn: () => fetchTrainingSkips(fromWeek), staleTime: STALE.default })
}
