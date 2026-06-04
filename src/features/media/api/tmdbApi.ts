import { tmdbFetch } from '../../../integrations/tmdb/client'
import type {
  TMDBMovie, TMDBTVSeries,
  TMDBSearchMovie, TMDBSearchTV,
  TMDBMovieFull, TMDBTVFull,
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

export const getMovieFull = (tmdbId: number) =>
  tmdbFetch<TMDBMovieFull>(`/movie/${tmdbId}`, { append_to_response: 'credits,watch/providers' })

export const getTVFull = (tmdbId: number) =>
  tmdbFetch<TMDBTVFull>(`/tv/${tmdbId}`, { append_to_response: 'credits,watch/providers' })

export const getUpcomingMovies = () =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/movie/upcoming')

export const getUpcomingTV = () =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/tv/on_the_air')
