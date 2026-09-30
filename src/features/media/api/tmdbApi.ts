import { tmdbFetch } from '../../../integrations/tmdb/client'
import type {
  TMDBSearchMovie, TMDBSearchTV,
  TMDBMovieFull, TMDBTVFull,
  TMDBCollection, TMDBBasic,
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

export const getCollection = (collectionId: number) =>
  tmdbFetch<TMDBCollection>(`/collection/${collectionId}`)

export const getBasic = (type: 'movie' | 'tv', tmdbId: number) =>
  tmdbFetch<TMDBBasic>(`/${type}/${tmdbId}`)

/** Streaming services available in Norway (TMDB /watch/providers, JustWatch data). */
export const getWatchProviders = (type: 'movie' | 'tv') =>
  tmdbFetch<{ results: (import('../types').TMDBWatchProvider & { display_priority?: number })[] }>(`/watch/providers/${type}`, { watch_region: 'NO' })

/** Popular titles included in a subscription on any of these services, in Norway. */
export const discoverOnServices = (type: 'movie' | 'tv', providerIds: number[]) =>
  tmdbFetch<PagedResponse<TMDBSearchMovie & TMDBSearchTV>>(`/discover/${type}`, {
    watch_region: 'NO',
    with_watch_providers: providerIds.join('|'),
    with_watch_monetization_types: 'flatrate',
    sort_by: 'popularity.desc',
  })

/** Popular (or trending-ish) titles no longer than `maxMin` minutes (movie runtime / episode runtime). */
export const discoverShort = (type: 'movie' | 'tv', maxMin: number, sort: 'popularity.desc' | 'vote_count.desc') =>
  tmdbFetch<PagedResponse<TMDBSearchMovie & TMDBSearchTV>>(`/discover/${type}`, {
    'with_runtime.lte': String(maxMin),
    'with_runtime.gte': '15',
    'vote_count.gte': '50',
    sort_by: sort,
  })
