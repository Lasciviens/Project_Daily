import { useQuery } from '@tanstack/react-query'
import {
  searchMovies, searchTV,
  getTrendingMovies, getTrendingTV,
  getPopularMovies, getPopularTV,
  getMovieDetails, getTVDetails,
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

export function useTrendingMovies(window: 'day' | 'week') {
  return useQuery({
    queryKey: ['tmdb', 'trending', 'movie', window],
    queryFn:  () => getTrendingMovies(window).then(r => r.results),
    staleTime: 5 * 60_000,
  })
}

export function useTrendingTV(window: 'day' | 'week') {
  return useQuery({
    queryKey: ['tmdb', 'trending', 'tv', window],
    queryFn:  () => getTrendingTV(window).then(r => r.results),
    staleTime: 5 * 60_000,
  })
}

export function usePopularMovies() {
  return useQuery({
    queryKey: ['tmdb', 'popular', 'movie'],
    queryFn:  () => getPopularMovies().then(r => r.results),
    staleTime: 10 * 60_000,
  })
}

export function usePopularTV() {
  return useQuery({
    queryKey: ['tmdb', 'popular', 'tv'],
    queryFn:  () => getPopularTV().then(r => r.results),
    staleTime: 10 * 60_000,
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
