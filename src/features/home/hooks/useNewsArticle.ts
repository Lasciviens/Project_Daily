import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchNewsArticle } from '../api/newsArticleApi'

/** One article's readable text for the in-app reader; fetched only while the reader is open. */
export function useNewsArticle(url: string | null) {
  return useQuery({
    queryKey: qk.external.newsArticle(url ?? ''),
    queryFn: () => fetchNewsArticle(url!),
    enabled: !!url,
    staleTime: STALE.hour,
    refetchOnWindowFocus: false,
    retry: 1,
  })
}
