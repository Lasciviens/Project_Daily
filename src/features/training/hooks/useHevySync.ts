import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchHevySyncState } from '../api/hevyApi'

/** The events-feed cursor: when the last incremental sync ran. */
export function useHevySyncState() {
  return useQuery({
    queryKey: qk.hevy.syncCursor(),
    queryFn:  fetchHevySyncState,
    staleTime: STALE.live,
  })
}

