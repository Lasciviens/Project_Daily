import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { todayStr } from '../../../shared/utils/dateUtils'
import { fetchDiscoverPage, getGenres } from '../api/tmdbApi'
import { discoverRequest, type DiscoverFilters, type DiscoverTab } from '../discoverModel'

/** A Discover list, page by page ("Show more" loads the next 20). */
export function useDiscoverList(tab: DiscoverTab, type: 'movie' | 'tv', filters: DiscoverFilters, providers: number[], enabled = true) {
  const today = todayStr()
  // hideLibrary is applied on the client, so it doesn't refetch.
  const server = { genre: filters.genre, fromYear: filters.fromYear, minRating: filters.minRating, sort: filters.sort }
  return useInfiniteQuery({
    queryKey: qk.media.tmdbQuery('discover', tab, type, server, [...providers].sort((a, b) => a - b), today),
    queryFn: ({ pageParam }) => {
      const r = discoverRequest(tab, type, filters, today, pageParam, providers)
      return fetchDiscoverPage(r.path, r.params)
    },
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.length < Math.min(last.total_pages, 25) ? all.length + 1 : undefined),
    enabled: enabled && (tab !== 'services' || providers.length > 0),
    staleTime: STALE.hour,
  })
}

export function useGenres(type: 'movie' | 'tv') {
  return useQuery({ queryKey: qk.media.tmdbQuery('genres', type), queryFn: () => getGenres(type).then(r => r.genres), staleTime: STALE.day })
}
