import { useQuery } from '@tanstack/react-query'
import { fetchStravaActivities } from '../api/hevyApi'

export function useStravaActivities(opts: {
  limit?: number
  type?: string
} = {}) {
  return useQuery({
    queryKey: ['strava', 'activities', opts],
    queryFn:  () => fetchStravaActivities(opts),
    staleTime: 5 * 60_000,
  })
}
