import { tmdbFetch } from '../../../integrations/tmdb/client'
import type {
  TMDBSearchMovie, TMDBSearchTV,
  TMDBMovieFull, TMDBTVFull,
  TMDBCollection, TMDBBasic,
} from '../types'

interface PagedResponse<T> { page?: number; results: T[]; total_results: number; total_pages: number }

export const searchMovies = (query: string, page = 1) =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>('/search/movie', { query, page: String(page) })

export const searchTV = (query: string, page = 1) =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>('/search/tv', { query, page: String(page) })

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

export const getSimilarMovies = (tmdbId: number) =>
  tmdbFetch<PagedResponse<TMDBSearchMovie>>(`/movie/${tmdbId}/similar`)

export const getSimilarTV = (tmdbId: number) =>
  tmdbFetch<PagedResponse<TMDBSearchTV>>(`/tv/${tmdbId}/similar`)

export const getSeasonDetails = (tvId: number, season: number) =>
  tmdbFetch<import('../types').TMDBSeasonDetail>(`/tv/${tvId}/season/${season}`)

export const getCollection = (collectionId: number) =>
  tmdbFetch<TMDBCollection>(`/collection/${collectionId}`)

export const getBasic = (type: 'movie' | 'tv', tmdbId: number) =>
  tmdbFetch<TMDBBasic>(`/${type}/${tmdbId}`)

/** Streaming services available in Norway (TMDB /watch/providers, JustWatch data). */
export const getWatchProviders = (type: 'movie' | 'tv') =>
  tmdbFetch<{ results: (import('../types').TMDBWatchProvider & { display_priority?: number })[] }>(`/watch/providers/${type}`, { watch_region: 'NO' })

/** Popular (or trending-ish) titles no longer than `maxMin` minutes (movie runtime / episode runtime). */
export const discoverShort = (type: 'movie' | 'tv', maxMin: number, sort: 'popularity.desc' | 'vote_count.desc') =>
  tmdbFetch<PagedResponse<TMDBSearchMovie & TMDBSearchTV>>(`/discover/${type}`, {
    'with_runtime.lte': String(maxMin),
    'with_runtime.gte': '15',
    'vote_count.gte': '50',
    sort_by: sort,
  })

// ── Smart lists: a franchise, studio, keyword or person, pulled from TMDB ──

export interface TMDBNamed { id: number; name: string; logo_path?: string | null; profile_path?: string | null; poster_path?: string | null; known_for_department?: string; origin_country?: string }

/** Search a smart-list source by name. */
export const searchSource = (kind: 'collection' | 'company' | 'keyword' | 'person', query: string) =>
  tmdbFetch<PagedResponse<TMDBNamed>>(`/search/${kind}`, { query })

/**
 * One page of a studio's / keyword's films, newest first (so a cap keeps the
 * recent ones). `hideExtras` leaves out documentaries and TV movies — the
 * featurettes and specials a studio or universe keyword drags in.
 */
export const discoverBySource = (kind: 'company' | 'keyword', id: number, page: number, hideExtras: boolean) =>
  tmdbFetch<PagedResponse<TMDBSearchMovie & { genre_ids?: number[] }>>('/discover/movie', {
    [kind === 'company' ? 'with_companies' : 'with_keywords']: String(id),
    sort_by: 'primary_release_date.desc',
    ...(hideExtras ? { without_genres: '99|10770' } : {}),
    page: String(page),
  })

export const getPersonMovieCredits = (id: number) =>
  tmdbFetch<{ cast: (TMDBSearchMovie & { character?: string; genre_ids?: number[] })[]; crew: (TMDBSearchMovie & { job?: string; genre_ids?: number[] })[] }>(`/person/${id}/movie_credits`)

/** One page of a Discover list (discoverModel.ts builds the request). */
export const fetchDiscoverPage = (path: string, params: Record<string, string>) =>
  tmdbFetch<PagedResponse<(TMDBSearchMovie & TMDBSearchTV) & { genre_ids?: number[]; original_language?: string; vote_count?: number }>>(path, params)

export const getGenres = (type: 'movie' | 'tv') =>
  tmdbFetch<{ genres: { id: number; name: string }[] }>(`/genre/${type}/list`)
