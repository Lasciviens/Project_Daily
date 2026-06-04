import { tmdbFetch } from '../../../integrations/tmdb/client'
import type {
  TMDBMovie, TMDBTVSeries,
  TMDBSearchMovie, TMDBSearchTV,
} from '../types'

interface PagedResponse<T> { results: T[]; total_results: number; total_pages: number }

export const searchMovies = (query: string) =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/search/movie', { query })

export const searchTV = (query: string) =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/search/tv', { query })

export const getTrendingMovies = (window: 'day' | 'week') =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>(`/trending/movie/${window}`)

export const getTrendingTV = (window: 'day' | 'week') =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>(`/trending/tv/${window}`)

export const getPopularMovies = () =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/movie/popular')

export const getPopularTV = () =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/tv/popular')

export const getMovieDetails = (tmdbId: number) =>
  tmdbFetch<TMDBMovie>(`/movie/${tmdbId}`)

export const getTVDetails = (tmdbId: number) =>
  tmdbFetch<TMDBTVSeries>(`/tv/${tmdbId}`)
