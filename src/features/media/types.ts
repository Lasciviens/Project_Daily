export interface Movie {
  id: string
  tmdb_id: number
  title: string
  original_title: string | null
  overview: string | null
  release_date: string | null
  runtime: number | null
  status: string | null
  poster_path: string | null
  backdrop_path: string | null
  genres: { id: number; name: string }[]
  tmdb_rating: number | null
  tmdb_vote_count: number | null
  /** MDBList scores (migrations 116/118); null until fetched. */
  rt_critics?: number | null
  rt_audience?: number | null
  metacritic?: number | null
  imdb_rating?: number | null
  letterboxd_rating?: number | null
  rt_url?: string | null
  ratings_fetched_at?: string | null
  /** TMDB's whole answer as stored on upsert; only the original language is read. */
  metadata_json?: { original_language?: string | null } | null
  created_at: string
}

export interface TVSeries {
  id: string
  tmdb_id: number
  title: string
  original_title: string | null
  overview: string | null
  first_air_date: string | null
  last_air_date: string | null
  status: string | null
  episode_run_time: number | null
  number_of_seasons: number | null
  number_of_episodes: number | null
  poster_path: string | null
  backdrop_path: string | null
  genres: { id: number; name: string }[]
  tmdb_rating: number | null
  tmdb_vote_count: number | null
  /** MDBList scores (migrations 116/118); null until fetched. */
  rt_critics?: number | null
  rt_audience?: number | null
  metacritic?: number | null
  imdb_rating?: number | null
  letterboxd_rating?: number | null
  rt_url?: string | null
  ratings_fetched_at?: string | null
  /** TMDB's whole answer as stored on upsert; only the original language is read. */
  metadata_json?: { original_language?: string | null } | null
  created_at: string
}

export interface UserMovieEntry {
  id: string
  user_id: string
  movie_id: string
  status: 'watching' | 'wishlist' | 'completed' | 'dropped' | 'upcoming'
  priority: 'low' | 'medium' | 'high'
  personal_note: string | null
  rating: number | null
  planned_date: string | null
  notify_before_days: number | null
  repeat_count: number
  watched_at: string | null
  is_favorite?: boolean
  created_at: string
  updated_at: string
  movie: Movie
}

export interface UserTVEntry {
  id: string
  user_id: string
  tv_series_id: string
  status: 'watching' | 'wishlist' | 'completed' | 'dropped' | 'paused'
  priority: 'low' | 'medium' | 'high'
  personal_note: string | null
  rating: number | null
  current_season: number
  current_episode: number
  planned_date: string | null
  notify_before_days: number | null
  repeat_count: number
  started_at: string | null
  finished_at: string | null
  is_favorite?: boolean
  created_at: string
  updated_at: string
  tv_series: TVSeries
}

// TMDB API response shapes
export interface TMDBMovie {
  id: number
  title: string
  original_title: string
  overview: string
  release_date: string
  original_language?: string
  spoken_languages?: { iso_639_1: string; english_name?: string; name?: string }[]
  runtime: number | null
  status: string
  poster_path: string | null
  backdrop_path: string | null
  genres: { id: number; name: string }[]
  vote_average: number
  vote_count: number
}

export interface TMDBTVSeries {
  id: number
  name: string
  original_name: string
  overview: string
  first_air_date: string
  last_air_date: string
  original_language?: string
  spoken_languages?: { iso_639_1: string; english_name?: string; name?: string }[]
  status: string
  episode_run_time: number[]
  number_of_seasons: number
  number_of_episodes: number
  poster_path: string | null
  backdrop_path: string | null
  genres: { id: number; name: string }[]
  vote_average: number
  vote_count: number
}

export interface TMDBSearchMovie {
  id: number
  title: string
  release_date: string
  poster_path: string | null
  backdrop_path?: string | null
  vote_average: number
  vote_count?: number
  original_language?: string
  overview: string
}

export interface TMDBSearchTV {
  id: number
  name: string
  first_air_date: string
  poster_path: string | null
  backdrop_path?: string | null
  vote_average: number
  vote_count?: number
  original_language?: string
  overview: string
}

export type MediaStatus = 'watching' | 'wishlist' | 'completed' | 'dropped' | 'paused' | 'upcoming'
export type MediaType = 'movie' | 'tv'

/** One title, for the popup's previous/next: the list a title was opened from, in its on-screen order. */
export interface MediaRef { tmdbId: number; mediaType: MediaType }
/** Open a title; `sequence` is the visible list it was picked from (the popup steps through it). */
export type OpenMediaDetail = (id: number, type: MediaType, sequence?: MediaRef[]) => void

export interface TMDBEpisode {
  id:             number
  name:           string
  overview:       string
  episode_number: number
  season_number:  number
  air_date:       string | null
  runtime:        number | null
  still_path:     string | null
  vote_average:   number
}

export interface TMDBSeasonDetail {
  id:             number
  name:           string
  season_number:  number
  episode_count:  number
  episodes:       TMDBEpisode[]
  poster_path:    string | null
  air_date:       string | null
}

// Matches the real `user_tv_episodes` table (migration 011_tv_episodes.sql).
// Earlier code referenced a nonexistent `watched_episodes` table with
// `season`/`episode`/`watched_on` — that table was never created; this is
// the corrected shape.
export interface WatchedEpisode {
  id:             string
  user_id:        string
  tv_entry_id:    string
  tv_series_id:   string
  season_number:  number
  episode_number: number
  watched_at:     string | null   // null = planned/not yet watched
  /** Plays − 1 (migration 116); absent before it. */
  repeat_count?:  number
}

export interface TMDBCastMember {
  id: number
  name: string
  character: string
  profile_path: string | null
  order: number
}

export interface TMDBCrewMember {
  id: number
  name: string
  job: string
  department: string
  profile_path: string | null
}

export interface TMDBVideo {
  id: string
  key: string
  name: string
  site: string
  type: string
}

export interface TMDBWatchProvider {
  provider_id: number
  provider_name: string
  logo_path: string
}

export interface TMDBWatchProviders {
  flatrate?: TMDBWatchProvider[]
  rent?: TMDBWatchProvider[]
  buy?: TMDBWatchProvider[]
}

export interface TMDBMovieFull extends TMDBMovie {
  tagline: string | null
  belongs_to_collection?: { id: number; name: string; poster_path: string | null } | null
  production_companies?: { id: number; name: string; logo_path: string | null }[]
  budget: number | null
  revenue: number | null
  credits: { cast: TMDBCastMember[]; crew: TMDBCrewMember[] }
  videos: { results: TMDBVideo[] }
  'watch/providers': { results: Record<string, TMDBWatchProviders> }
}

export interface TMDBTVFull extends TMDBTVSeries {
  tagline: string | null
  created_by: { id: number; name: string }[]
  networks: { id: number; name: string; logo_path: string | null }[]
  next_episode_to_air: { name: string; air_date: string; episode_number: number; season_number: number } | null
  seasons: { id: number; name: string; season_number: number; episode_count: number; poster_path: string | null; air_date: string | null }[]
  credits: { cast: TMDBCastMember[]; crew: TMDBCrewMember[] }
  videos: { results: TMDBVideo[] }
  'watch/providers': { results: Record<string, TMDBWatchProviders> }
}

export interface TMDBCollection {
  id: number
  name: string
  overview: string | null
  poster_path: string | null
  parts: { id: number; title: string; release_date?: string; poster_path: string | null }[]
}

/** The few fields a poster tile needs (TMDB /movie/{id} or /tv/{id}, no appends). */
export interface TMDBBasic {
  id: number; title?: string; name?: string; poster_path: string | null; release_date?: string; first_air_date?: string
  /** TV only. */
  next_episode_to_air?: { air_date: string | null; season_number: number; episode_number: number; name: string } | null
}
