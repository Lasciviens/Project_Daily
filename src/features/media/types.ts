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
  created_at: string
}

export interface UserMovieEntry {
  id: string
  user_id: string
  movie_id: string
  status: 'watching' | 'wishlist' | 'completed' | 'dropped'
  priority: 'low' | 'medium' | 'high'
  personal_note: string | null
  rating: number | null
  planned_date: string | null
  notify_before_days: number | null
  repeat_count: number
  watched_at: string | null
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
  vote_average: number
  overview: string
}

export interface TMDBSearchTV {
  id: number
  name: string
  first_air_date: string
  poster_path: string | null
  vote_average: number
  overview: string
}

export type MediaStatus = 'watching' | 'wishlist' | 'completed' | 'dropped' | 'paused'
export type MediaType = 'movie' | 'tv'
