import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import {
  searchMovies, searchTV,
  getTrendingMovies, getTrendingTV,
  getPopularMovies, getPopularTV,
  getMovieFull, getTVFull,
  getUpcomingMovies, getUpcomingTV,
  getSimilarMovies, getSimilarTV,
  getNorwegianMovies, getNorwegianTV,
  getNorwegianTopRatedMovies, getNorwegianTopRatedTV,
  getSeasonDetails,
  getCollection, getBasic,
  getWatchProviders, discoverOnServices, discoverShort,
} from '../api/tmdbApi'

const key = qk.media.tmdbQuery

export function useSearchMovies(query: string) {
  return useQuery({
    queryKey: key('search', 'movie', query),
    queryFn:  () => searchMovies(query).then(r => r.results),
    enabled:  query.trim().length > 1,
    staleTime: STALE.short,
  })
}

export function useSearchTV(query: string) {
  return useQuery({
    queryKey: key('search', 'tv', query),
    queryFn:  () => searchTV(query).then(r => r.results),
    enabled:  query.trim().length > 1,
    staleTime: STALE.short,
  })
}

// Discovery lists are cached for a day — refreshed only by an explicit tap.
export function useTrendingMovies(window: 'day' | 'week', enabled = true) {
  return useQuery({
    enabled,
    queryKey: key('trending', 'movie', window),
    queryFn:  () => getTrendingMovies(window).then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useTrendingTV(window: 'day' | 'week', enabled = true) {
  return useQuery({
    enabled,
    queryKey: key('trending', 'tv', window),
    queryFn:  () => getTrendingTV(window).then(r => r.results),
    staleTime: STALE.day,
  })
}

export function usePopularMovies(enabled = true) {
  return useQuery({
    enabled,
    queryKey: key('popular', 'movie'),
    queryFn:  () => getPopularMovies().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function usePopularTV(enabled = true) {
  return useQuery({
    enabled,
    queryKey: key('popular', 'tv'),
    queryFn:  () => getPopularTV().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useMovieFull(tmdbId: number | null) {
  return useQuery({
    queryKey: key('full', 'movie', tmdbId),
    queryFn:  () => getMovieFull(tmdbId!),
    enabled:  tmdbId !== null,
    staleTime: STALE.hour,
  })
}

export function useTVFull(tmdbId: number | null) {
  return useQuery({
    queryKey: key('full', 'tv', tmdbId),
    queryFn:  () => getTVFull(tmdbId!),
    enabled:  tmdbId !== null,
    staleTime: STALE.hour,
  })
}

export function useUpcomingMovies(enabled = true) {
  return useQuery({
    enabled,
    queryKey: key('upcoming', 'movie'),
    queryFn:  () => getUpcomingMovies().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useUpcomingTV(enabled = true) {
  return useQuery({
    enabled,
    queryKey: key('upcoming', 'tv'),
    queryFn:  () => getUpcomingTV().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useNorwegianMovies() {
  return useQuery({
    queryKey: key('norwegian', 'movie'),
    queryFn:  () => getNorwegianMovies().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useNorwegianTV() {
  return useQuery({
    queryKey: key('norwegian', 'tv'),
    queryFn:  () => getNorwegianTV().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useNorwegianTopRatedMovies() {
  return useQuery({
    queryKey: key('norwegian', 'movie', 'top-rated'),
    queryFn:  () => getNorwegianTopRatedMovies().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useNorwegianTopRatedTV() {
  return useQuery({
    queryKey: key('norwegian', 'tv', 'top-rated'),
    queryFn:  () => getNorwegianTopRatedTV().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useSeasonDetails(tvId: number | null, season: number | null) {
  return useQuery({
    queryKey: key('season', tvId, season),
    queryFn:  () => getSeasonDetails(tvId!, season!),
    enabled:  tvId !== null && season !== null && season > 0,
    staleTime: STALE.hour,
  })
}

export function useSimilarMovies(tmdbId: number | null) {
  return useQuery({
    queryKey: key('similar', 'movie', tmdbId),
    queryFn:  () => getSimilarMovies(tmdbId!).then(r => r.results.slice(0, 12)),
    enabled:  tmdbId !== null,
    staleTime: STALE.day,
  })
}

export function useSimilarTV(tmdbId: number | null) {
  return useQuery({
    queryKey: key('similar', 'tv', tmdbId),
    queryFn:  () => getSimilarTV(tmdbId!).then(r => r.results.slice(0, 12)),
    enabled:  tmdbId !== null,
    staleTime: STALE.day,
  })
}

export function useCollection(collectionId: number | null) {
  return useQuery({
    queryKey: key('collection', collectionId),
    queryFn:  () => getCollection(collectionId!),
    enabled:  collectionId !== null,
    staleTime: STALE.day,
  })
}

/** Poster + title for a tile when only the TMDB id is known (list items not in the library). */
export function useTmdbBasic(type: 'movie' | 'tv', tmdbId: number | null, enabled = true) {
  return useQuery({
    queryKey: key('basic', type, tmdbId),
    queryFn:  () => getBasic(type, tmdbId!),
    enabled:  enabled && tmdbId !== null,
    staleTime: STALE.day,
  })
}

/** A season's episodes through the same cache as useSeasonDetails (for a one-off read). */
export function fetchSeasonCached(qc: import('@tanstack/react-query').QueryClient, tvId: number, season: number) {
  return qc.fetchQuery({ queryKey: key('season', tvId, season), queryFn: () => getSeasonDetails(tvId, season), staleTime: STALE.hour })
}

/** Air dates (yyyy-MM-dd) of the given episodes, keyed `SxE`; seasons are read once each. */
export async function episodeAirDates(qc: import('@tanstack/react-query').QueryClient, tvId: number, refs: { season: number; episode: number }[]) {
  const out = new Map<string, string | null>()
  const seasons = [...new Set(refs.map(r => r.season))]
  const details = await Promise.all(seasons.map(s => fetchSeasonCached(qc, tvId, s).catch(() => null)))
  details.forEach(d => { for (const e of d?.episodes ?? []) out.set(`${d!.season_number}x${e.episode_number}`, e.air_date ?? null) })
  return out
}

export function useWatchProviders(type: 'movie' | 'tv', enabled = true) {
  return useQuery({
    queryKey: key('providers', type, 'NO'),
    queryFn:  () => getWatchProviders(type).then(r => [...r.results].sort((a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999))),
    enabled,
    staleTime: STALE.day,
  })
}

export function useOnMyServices(type: 'movie' | 'tv', providerIds: number[], enabled = true) {
  return useQuery({
    queryKey: key('on-services', type, [...providerIds].sort((a, b) => a - b).join(',')),
    queryFn:  () => discoverOnServices(type, providerIds).then(r => r.results),
    enabled:  enabled && providerIds.length > 0,
    staleTime: STALE.day,
  })
}

export function useShortTitles(type: 'movie' | 'tv', maxMin: number, sort: 'popularity.desc' | 'vote_count.desc', enabled = true) {
  return useQuery({
    queryKey: key('short', type, maxMin, sort),
    queryFn:  () => discoverShort(type, maxMin, sort).then(r => r.results),
    enabled:  enabled && maxMin > 0,
    staleTime: STALE.day,
  })
}
