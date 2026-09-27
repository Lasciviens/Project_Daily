import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { daysAgoStr, todayStr } from '../../../shared/utils/dateUtils'
import { fetchTrainingHistory, fetchBodyweightHistory } from '../api/hevyApi'

// 6-month window — long enough to show a real trend, short enough that the
// paginated hevy_sets fetch stays cheap. Everything on the Progress page
// (including "best in 6 months" events) reads this same window.
export const TRAINING_HISTORY_DAYS = 182

export function useTrainingHistory() {
  // Keyed by the LOCAL start day (a UTC key flipped a day early between
  // local midnight and 02:00); the fetch itself uses exact instants.
  const fromDay = daysAgoStr(TRAINING_HISTORY_DAYS)
  return useQuery({
    queryKey: qk.hevy.trainingHistory(fromDay),
    queryFn:  () => {
      const to = new Date()
      const from = new Date(fromDay + 'T00:00:00')
      return fetchTrainingHistory(from.toISOString(), to.toISOString())
    },
    staleTime: STALE.long,
  })
}

// Same window as useTrainingHistory — feeds the Relative Strength chart's
// bodyweight-resolution ladder and the Progress bodyweight KPI.
export function useBodyweightHistory() {
  const toStr = todayStr()
  const fromStr = daysAgoStr(TRAINING_HISTORY_DAYS)
  return useQuery({
    queryKey: qk.hevy.bodyweightHistory(fromStr, toStr),
    queryFn:  () => fetchBodyweightHistory(fromStr, toStr),
    staleTime: STALE.long,
  })
}
