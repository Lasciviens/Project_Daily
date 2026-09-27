import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchStravaActivities } from '../api/trainingApi'

/** `from`/`to` are ISO instants on the activity's start. */
export function useStravaActivities(opts: {
  limit?: number
  type?: string
  from?: string
  to?: string
} = {}, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.strava.activities(opts),
    queryFn:  () => fetchStravaActivities(opts),
    staleTime: STALE.default,
    placeholderData: keepPreviousData,
    enabled,
  })
}
