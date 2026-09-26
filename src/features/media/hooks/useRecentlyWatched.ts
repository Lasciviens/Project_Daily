import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchRecentlyWatched } from '../api/recentApi'

export type { RecentlyWatchedItem } from '../api/recentApi'

/** Home's "recently watched" strip. Refreshed by the `media` / `episodeWatched` groups. */
export function useRecentlyWatched({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey:  qk.media.recent(),
    queryFn:   () => fetchRecentlyWatched(),
    staleTime: STALE.default,
    enabled,
  })
}
