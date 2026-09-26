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
export function useTrendingMovies(window: 'day' | 'week') {
  return useQuery({
    queryKey: key('trending', 'movie', window),
    queryFn:  () => getTrendingMovies(window).then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useTrendingTV(window: 'day' | 'week') {
  return useQuery({
    queryKey: key('trending', 'tv', window),
    queryFn:  () => getTrendingTV(window).then(r => r.results),
    staleTime: STALE.day,
  })
}

export function usePopularMovies() {
  return useQuery({
    queryKey: key('popular', 'movie'),
    queryFn:  () => getPopularMovies().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function usePopularTV() {
  return useQuery({
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

export function useUpcomingMovies() {
  return useQuery({
    queryKey: key('upcoming', 'movie'),
    queryFn:  () => getUpcomingMovies().then(r => r.results),
    staleTime: STALE.day,
  })
}

export function useUpcomingTV() {
  return useQuery({
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
