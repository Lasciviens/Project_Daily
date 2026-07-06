import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { TVSeries, UserTVEntry, TMDBTVSeries } from '../types'

export async function fetchUserTVEntries(): Promise<UserTVEntry[]> {
  const { data, error } = await supabase
    .from('user_tv_entries')
    .select('*, tv_series:tv_series(*)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function upsertTVSeries(tmdb: TMDBTVSeries): Promise<TVSeries> {
  const { data, error } = await supabase
    .from('tv_series')
    .upsert(
      {
        tmdb_id:             tmdb.id,
        title:               tmdb.name,
        original_title:      tmdb.original_name,
        overview:            tmdb.overview,
        first_air_date:      tmdb.first_air_date || null,
        last_air_date:       tmdb.last_air_date  || null,
        status:              tmdb.status,
        episode_run_time:    tmdb.episode_run_time[0] ?? null,
        number_of_seasons:   tmdb.number_of_seasons,
        number_of_episodes:  tmdb.number_of_episodes,
        poster_path:         tmdb.poster_path,
        backdrop_path:       tmdb.backdrop_path,
        genres:              tmdb.genres,
        tmdb_rating:         tmdb.vote_average,
        tmdb_vote_count:     tmdb.vote_count,
        metadata_json:       tmdb,
      },
      { onConflict: 'tmdb_id' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function addTVEntry(
  tvSeriesId: string,
  status: UserTVEntry['status'],
  priority: UserTVEntry['priority'] = 'medium'
): Promise<UserTVEntry> {
  const user = await requireUser()

  const { data, error } = await supabase
    .from('user_tv_entries')
    .insert({ user_id: user.id, tv_series_id: tvSeriesId, status, priority })
    .select('*, tv_series:tv_series(*)')
    .single()
  if (error) throw error
  return data
}

export async function updateTVEntry(
  id: string,
  patch: Partial<Pick<UserTVEntry, 'status' | 'priority' | 'personal_note' | 'rating' | 'current_season' | 'current_episode' | 'planned_date' | 'notify_before_days' | 'repeat_count' | 'started_at' | 'finished_at'>>
): Promise<UserTVEntry> {
  const { data, error } = await supabase
    .from('user_tv_entries')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, tv_series:tv_series(*)')
    .single()
  if (error) throw error
  return data
}

export async function deleteTVEntry(id: string): Promise<void> {
  const { error } = await supabase.from('user_tv_entries').delete().eq('id', id)
  if (error) throw error
}
