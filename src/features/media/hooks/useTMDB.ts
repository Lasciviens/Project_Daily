import { useQuery } from '@tanstack/react-query'
import {
  searchMovies, searchTV,
  getTrendingMovies, getTrendingTV,
  getPopularMovies, getPopularTV,
  getMovieDetails, getTVDetails,
  getMovieFull, getTVFull,
  getUpcomingMovies, getUpcomingTV,
  getSimilarMovies, getSimilarTV,
} from '../api/tmdbApi'

export function useSearchMovies(query: string) {
  return useQuery({
    queryKey: ['tmdb', 'search', 'movie', query],
    queryFn:  () => searchMovies(query).then(r => r.results),
    enabled:  query.trim().length > 1,
    staleTime: 60_000,
  })
}

export function useSearchTV(query: string) {
  return useQuery({
    queryKey: ['tmdb', 'search', 'tv', query],
    queryFn:  () => searchTV(query).then(r => r.results),
    enabled:  query.trim().length > 1,
    staleTime: 60_000,
  })
}

// Trending/popular data is stable enough for 1hr caching
export function useTrendingMovies(window: 'day' | 'week', refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['tmdb', 'trending', 'movie', window],
    queryFn:  () => getTrendingMovies(window).then(r => r.results),
    staleTime: 60 * 60_000,
    refetchInterval,
  })
}

export function useTrendingTV(window: 'day' | 'week', refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['tmdb', 'trending', 'tv', window],
    queryFn:  () => getTrendingTV(window).then(r => r.results),
    staleTime: 60 * 60_000,
    refetchInterval,
  })
}

export function usePopularMovies(refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['tmdb', 'popular', 'movie'],
    queryFn:  () => getPopularMovies().then(r => r.results),
    staleTime: 60 * 60_000,
    refetchInterval,
  })
}

export function usePopularTV(refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['tmdb', 'popular', 'tv'],
    queryFn:  () => getPopularTV().then(r => r.results),
    staleTime: 60 * 60_000,
    refetchInterval,
  })
}

export function useMovieDetails(tmdbId: number | null) {
  return useQuery({
    queryKey: ['tmdb', 'detail', 'movie', tmdbId],
    queryFn:  () => getMovieDetails(tmdbId!),
    enabled:  tmdbId !== null,
    staleTime: 30 * 60_000,
  })
}

export function useTVDetails(tmdbId: number | null) {
  return useQuery({
    queryKey: ['tmdb', 'detail', 'tv', tmdbId],
    queryFn:  () => getTVDetails(tmdbId!),
    enabled:  tmdbId !== null,
    staleTime: 30 * 60_000,
  })
}

export function useMovieFull(tmdbId: number | null) {
  return useQuery({
    queryKey: ['tmdb', 'full', 'movie', tmdbId],
    queryFn:  () => getMovieFull(tmdbId!),
    enabled:  tmdbId !== null,
    staleTime: 30 * 60_000,
  })
}

export function useTVFull(tmdbId: number | null) {
  return useQuery({
    queryKey: ['tmdb', 'full', 'tv', tmdbId],
    queryFn:  () => getTVFull(tmdbId!),
    enabled:  tmdbId !== null,
    staleTime: 30 * 60_000,
  })
}

export function useUpcomingMovies(refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['tmdb', 'upcoming', 'movie'],
    queryFn:  () => getUpcomingMovies().then(r => r.results),
    staleTime: 60 * 60_000,
    refetchInterval,
  })
}

export function useUpcomingTV(refetchInterval?: number | false) {
  return useQuery({
    queryKey: ['tmdb', 'upcoming', 'tv'],
    queryFn:  () => getUpcomingTV().then(r => r.results),
    staleTime: 60 * 60_000,
    refetchInterval,
  })
}

// Similar content — very stable, cache 24hrs
export function useSimilarMovies(tmdbId: number | null) {
  return useQuery({
    queryKey: ['tmdb', 'similar', 'movie', tmdbId],
    queryFn:  () => getSimilarMovies(tmdbId!).then(r => r.results.slice(0, 12)),
    enabled:  tmdbId !== null,
    staleTime: 24 * 60 * 60_000,
  })
}

export function useSimilarTV(tmdbId: number | null) {
  return useQuery({
    queryKey: ['tmdb', 'similar', 'tv', tmdbId],
    queryFn:  () => getSimilarTV(tmdbId!).then(r => r.results.slice(0, 12)),
    enabled:  tmdbId !== null,
    staleTime: 24 * 60 * 60_000,
  })
}
