import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchHevyPRs } from '../api/hevyApi'

/** All-time personal records (personalRecords.ts has the one definition). */
export function useHevyPRs() {
  return useQuery({
    queryKey: qk.hevy.prs(),
    queryFn:  fetchHevyPRs,
    staleTime: STALE.long,
  })
}
