import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { todayStr } from '../../../shared/utils/dateUtils'
import { fetchDiscoverPage, getGenres } from '../api/tmdbApi'
import { discoverRequest, type DiscoverFilters, type DiscoverTab } from '../discoverModel'

// TMDB pages hold 20; one step here is two of them, so "Show more" adds 40.
const TMDB_PAGES_PER_STEP = 2
const MAX_TMDB_PAGES = 26

/** A Discover list, step by step ("Show more" loads the next 40). */
export function useDiscoverList(tab: DiscoverTab, type: 'movie' | 'tv', filters: DiscoverFilters, providers: number[], enabled = true) {
  const today = todayStr()
  // hideLibrary is applied on the client, so it doesn't refetch.
  const args = (page: number) => {
    const r = discoverRequest(tab, type, filters, today, page, providers)
    return [r.path, r.params] as const
  }
  const server = { genre: filters.genre, fromYear: filters.fromYear, minRating: filters.minRating, sort: filters.sort }
  return useInfiniteQuery({
    queryKey: qk.media.tmdbQuery('discover', tab, type, server, [...providers].sort((a, b) => a - b), today),
    queryFn: async ({ pageParam }) => {
      const first = (pageParam - 1) * TMDB_PAGES_PER_STEP + 1
      const head = await fetchDiscoverPage(...args(first))
      const rest = Array.from({ length: TMDB_PAGES_PER_STEP - 1 }, (_, i) => first + 1 + i).filter(n => n <= Math.min(head.total_pages, MAX_TMDB_PAGES))
      const more = await Promise.all(rest.map(n => fetchDiscoverPage(...args(n))))
      return { ...head, page: pageParam, lastTmdbPage: first + rest.length, results: [head, ...more].flatMap(p => p.results) }
    },
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.lastTmdbPage < Math.min(last.total_pages, MAX_TMDB_PAGES) ? all.length + 1 : undefined),
    enabled: enabled && (tab !== 'services' || providers.length > 0),
    staleTime: STALE.hour,
  })
}

export function useGenres(type: 'movie' | 'tv') {
  return useQuery({ queryKey: qk.media.tmdbQuery('genres', type), queryFn: () => getGenres(type).then(r => r.genres), staleTime: STALE.day })
}
