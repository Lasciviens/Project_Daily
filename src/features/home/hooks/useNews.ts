import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchNews } from '../api/newsApi'

/**
 * Enough headlines for the longest news card (NewsWidget lists 8, or 16 when
 * it has a column of its own), so a layout change never refetches.
 */
const NEWS_ITEMS = 16

/** Headlines for one feed (see NEWS_FEEDS). Rate-limited upstream: no focus refetch. */
export function useNews(feedKey: string, { enabled = true, refetchInterval = false }: { enabled?: boolean; refetchInterval?: number | false } = {}) {
  return useQuery({
    queryKey: qk.external.news(feedKey),
    queryFn:  () => fetchNews(feedKey, NEWS_ITEMS),
    staleTime: STALE.long,
    refetchOnWindowFocus: false,
    refetchInterval,
    enabled,
  })
}
