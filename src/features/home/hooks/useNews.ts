import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchNews } from '../api/newsApi'

/**
 * Enough headlines for the widest news band (homeBoard NEWS_ROWS: 8 on a
 * phone up to 16 at 2450), so a layout change never refetches.
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
