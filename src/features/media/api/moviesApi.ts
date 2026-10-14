import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { Movie, UserMovieEntry, TMDBMovie } from '../types'
import { isBefore149, WATCH_COLUMNS } from './watchesApi'

/** The library's movies, each with its watches (migration 149; without them before it). */
export async function fetchUserMovieEntries(): Promise<UserMovieEntry[]> {
  const read = (cols: string) => supabase.from('user_movie_entries').select(cols).order('created_at', { ascending: false })
  let { data, error } = await read(`*, movie:movies(*), watches:media_watches(${WATCH_COLUMNS})`)
  // Fallback (remove once 149 has run everywhere).
  if (error && isBefore149(error)) ({ data, error } = await read('*, movie:movies(*)'))
  if (error) throw error
  return (data ?? []) as unknown as UserMovieEntry[]
}

export async function upsertMovie(tmdb: TMDBMovie): Promise<Movie> {
  const { data, error } = await supabase
    .from('movies')
    .upsert(
      {
        tmdb_id:        tmdb.id,
        title:          tmdb.title,
        original_title: tmdb.original_title,
        overview:       tmdb.overview,
        release_date:   tmdb.release_date || null,
        runtime:        tmdb.runtime,
        status:         tmdb.status,
        poster_path:    tmdb.poster_path,
        backdrop_path:  tmdb.backdrop_path,
        genres:         tmdb.genres,
        tmdb_rating:    tmdb.vote_average,
        tmdb_vote_count: tmdb.vote_count,
        metadata_json:  tmdb,
      },
      { onConflict: 'tmdb_id' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function addMovieEntry(
  movieId: string,
  status: UserMovieEntry['status'],
  priority: UserMovieEntry['priority'] = 'medium',
  extra: Partial<Pick<UserMovieEntry, 'watched_at'>> = {},
): Promise<UserMovieEntry> {
  const user = await requireUser()

  // The watch date goes in with the row, so the Trakt outbox trigger sends it on insert.
  const { data, error } = await supabase
    .from('user_movie_entries')
    .insert({ user_id: user.id, movie_id: movieId, status, priority, ...extra })
    .select('*, movie:movies(*)')
    .single()
  if (error) throw error
  return data
}

export async function updateMovieEntry(
  id: string,
  patch: Partial<Pick<UserMovieEntry, 'status' | 'priority' | 'personal_note' | 'rating' | 'planned_date' | 'notify_before_days' | 'repeat_count' | 'watched_at' | 'is_favorite' | 'rewatch_round'>>
): Promise<UserMovieEntry> {
  const { data, error } = await supabase
    .from('user_movie_entries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, movie:movies(*)')
    .single()
  if (error) throw error
  return data
}

