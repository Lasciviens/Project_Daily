import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { WatchedEpisode } from '../types'

// The table stores `tv_series_id` denormalized (NOT NULL) alongside
// `tv_entry_id`, so every write needs it resolved from the entry first.
async function resolveTvSeriesId(tvEntryId: string): Promise<string> {
  const { data, error } = await supabase
    .from('user_tv_entries')
    .select('tv_series_id')
    .eq('id', tvEntryId)
    .single()
  if (error) throw error
  return data.tv_series_id
}

export async function fetchWatchedEpisodes(tvEntryId: string): Promise<WatchedEpisode[]> {
  const { data, error } = await supabase
    .from('user_tv_episodes')
    .select('*')
    .eq('tv_entry_id', tvEntryId)
    .not('watched_at', 'is', null)
    .order('season_number', { ascending: true })
    .order('episode_number', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function markEpisodeWatched(
  tvEntryId: string,
  season: number,
  episode: number,
  watchedOn: string,
): Promise<WatchedEpisode> {
  const user = await requireUser()
  const tvSeriesId = await resolveTvSeriesId(tvEntryId)
  const { data, error } = await supabase
    .from('user_tv_episodes')
    .upsert({
      user_id:        user.id,
      tv_entry_id:    tvEntryId,
      tv_series_id:   tvSeriesId,
      season_number:  season,
      episode_number: episode,
      watched_at:     new Date(watchedOn + 'T12:00:00').toISOString(),
    }, { onConflict: 'user_id,tv_series_id,season_number,episode_number' })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function unmarkEpisodeWatched(
  tvEntryId: string,
  season: number,
  episode: number,
): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase
    .from('user_tv_episodes')
    .delete()
    .eq('user_id', user.id)
    .eq('tv_entry_id', tvEntryId)
    .eq('season_number', season)
    .eq('episode_number', episode)
  if (error) throw error
}
