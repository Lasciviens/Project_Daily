import { supabase } from '../../../integrations/supabase/client'
import type { WatchedEpisode } from '../types'

export async function fetchWatchedEpisodes(tvEntryId: string): Promise<WatchedEpisode[]> {
  const { data, error } = await supabase
    .from('watched_episodes')
    .select('*')
    .eq('tv_entry_id', tvEntryId)
    .order('season', { ascending: true })
    .order('episode', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function markEpisodeWatched(
  tvEntryId: string,
  season: number,
  episode: number,
  watchedOn: string,
): Promise<WatchedEpisode> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { data, error } = await supabase
    .from('watched_episodes')
    .upsert({
      user_id:     user.id,
      tv_entry_id: tvEntryId,
      season,
      episode,
      watched_on:  watchedOn,
    }, { onConflict: 'user_id,tv_entry_id,season,episode' })
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { error } = await supabase
    .from('watched_episodes')
    .delete()
    .eq('user_id', user.id)
    .eq('tv_entry_id', tvEntryId)
    .eq('season', season)
    .eq('episode', episode)
  if (error) throw error
}
