import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchStravaActivities } from '../api/hevyApi'

export function useStravaActivities(opts: {
  limit?: number
  type?: string
} = {}, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.strava.activities(opts),
    queryFn:  () => fetchStravaActivities(opts),
    staleTime: STALE.default,
    enabled,
  })
}
