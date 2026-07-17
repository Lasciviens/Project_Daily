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

// Recompute the entry's current_season/current_episode cache from the max
// watched episode. Migration 050 installs a DB trigger doing the same thing
// authoritatively — this app-side copy exists so the UI is correct even
// before that migration is applied, and so the change is visible instantly
// (same-request) instead of on next refetch. Idempotent with the trigger.
// Real bug this fixes: migration 011 documented these cache columns as
// "updated via application logic when a new watched episode is recorded",
// but that logic never existed — every consumer (Daily Watch-next, AI
// briefing, get_media, stats) read a cache frozen at S1·E0.
async function syncEntryProgress(tvEntryId: string): Promise<void> {
  const { data } = await supabase
    .from('user_tv_episodes')
    .select('season_number, episode_number')
    .eq('tv_entry_id', tvEntryId)
    .not('watched_at', 'is', null)
    .order('season_number', { ascending: false })
    .order('episode_number', { ascending: false })
    .limit(1)
  const max = data?.[0]
  await supabase
    .from('user_tv_entries')
    .update({ current_season: max?.season_number ?? 1, current_episode: max?.episode_number ?? 0 })
    .eq('id', tvEntryId)
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
  await syncEntryProgress(tvEntryId)
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
  await syncEntryProgress(tvEntryId)
}
