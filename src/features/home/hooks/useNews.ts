import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchNews } from '../api/newsApi'

/** Headlines for one feed (see NEWS_FEEDS). Rate-limited upstream: no focus refetch. */
export function useNews(feedKey: string, { enabled = true, refetchInterval = false }: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: qk.external.news(feedKey),
    queryFn:  () => fetchNews(feedKey),
    staleTime: STALE.long,
    refetchOnWindowFocus: false,
    refetchInterval,
    enabled,
  })
}
