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
  tmdbFetch<TMDBMovieFull>(`/movie/${tmdbId}`, { append_to_response: 'credits,watch/providers,videos' })

export const getTVFull = (tmdbId: number) =>
  tmdbFetch<TMDBTVFull>(`/tv/${tmdbId}`, { append_to_response: 'credits,watch/providers,videos' })

export const getUpcomingMovies = () =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/movie/upcoming')

export const getUpcomingTV = () =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/tv/on_the_air')

export const getSimilarMovies = (tmdbId: number) =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>(`/movie/${tmdbId}/similar`)

export const getSimilarTV = (tmdbId: number) =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>(`/tv/${tmdbId}/similar`)

export const getNorwegianMovies = () =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/discover/movie', {
    with_origin_country: 'NO',
    sort_by: 'popularity.desc',
  })

export const getNorwegianTV = () =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/discover/tv', {
    with_origin_country: 'NO',
    sort_by: 'popularity.desc',
  })

export const getNorwegianTopRatedMovies = () =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/discover/movie', {
    with_origin_country: 'NO',
    sort_by: 'vote_average.desc',
    'vote_count.gte': '50',
  })

export const getNorwegianTopRatedTV = () =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/discover/tv', {
    with_origin_country: 'NO',
    sort_by: 'vote_average.desc',
    'vote_count.gte': '20',
  })

export const getSeasonDetails = (tvId: number, season: number) =>
  tmdbFetch<import('../types').TMDBSeasonDetail>(`/tv/${tvId}/season/${season}`)

export const getMovieGenres = () =>
  tmdbFetch<{ genres: { id: number; name: string }[] }>('/genre/movie/list')

export const getTVGenres = () =>
  tmdbFetch<{ genres: { id: number; name: string }[] }>('/genre/tv/list')

export const discoverMovies = (params: Record<string, string>) =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/discover/movie', params)

export const discoverTV = (params: Record<string, string>) =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/discover/tv', params)
