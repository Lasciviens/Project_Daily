import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { WatchedEpisode } from '../types'
import { middayIso } from '../watchedWhen'

/** A yyyy-MM-dd day (midday local) or an exact ISO timestamp. */
const toIso = (v: string) => (v.length === 10 ? middayIso(v) : v)

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
  // Paged past PostgREST's 1,000-row cap (a long-running show can pass it).
  const out: WatchedEpisode[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('user_tv_episodes')
      .select('*')
      .eq('tv_entry_id', tvEntryId)
      .not('watched_at', 'is', null)
      .order('season_number', { ascending: true })
      .order('episode_number', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
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
  // Already watched (here or on Trakt): keep its real date. Overwriting it
  // with today would lose when it was actually seen; a rewatch is
  // rewatchEpisode, which counts a play instead.
  const { data: existing, error: readErr } = await supabase
    .from('user_tv_episodes').select('*')
    .eq('user_id', user.id).eq('tv_series_id', tvSeriesId)
    .eq('season_number', season).eq('episode_number', episode)
    .maybeSingle()
  if (readErr) throw readErr
  if (existing?.watched_at) return existing
  const { data, error } = await supabase
    .from('user_tv_episodes')
    .upsert({
      user_id:        user.id,
      tv_entry_id:    tvEntryId,
      tv_series_id:   tvSeriesId,
      season_number:  season,
      episode_number: episode,
      watched_at:     toIso(watchedOn),
    }, { onConflict: 'user_id,tv_series_id,season_number,episode_number' })
    .select()
    .single()
  if (error) throw error
  await syncEntryProgress(tvEntryId)
  return data
}

/**
 * Many episodes at once ("watched up to here", a whole season): one read, one
 * upsert, one progress sync. Episodes already watched keep their real date.
 */
export async function markEpisodesWatched(
  tvEntryId: string,
  refs: { season: number; episode: number; at?: string }[],
  watchedOn: string,
): Promise<void> {
  if (refs.length === 0) return
  const user = await requireUser()
  const tvSeriesId = await resolveTvSeriesId(tvEntryId)
  const { data: have, error: readErr } = await supabase
    .from('user_tv_episodes').select('season_number, episode_number')
    .eq('user_id', user.id).eq('tv_series_id', tvSeriesId)
    .not('watched_at', 'is', null)
  if (readErr) throw readErr
  const seen = new Set((have ?? []).map(r => `${r.season_number}x${r.episode_number}`))
  const rows = refs
    .filter(r => !seen.has(`${r.season}x${r.episode}`))
    .map(r => ({
      user_id: user.id, tv_entry_id: tvEntryId, tv_series_id: tvSeriesId,
      season_number: r.season, episode_number: r.episode, watched_at: toIso(r.at ?? watchedOn),
    }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase
      .from('user_tv_episodes')
      .upsert(rows.slice(i, i + 500), { onConflict: 'user_id,tv_series_id,season_number,episode_number' })
    if (error) throw error
  }
  await syncEntryProgress(tvEntryId)
}

/**
 * Change when already-watched episodes were watched (e.g. every one to its own
 * release date). Keeps plays; one upsert per 500 rows. The outbox trigger
 * (migration 120) resends those plays to Trakt at the new date.
 */
export async function setEpisodesWatchedAt(tvEntryId: string, refs: { season: number; episode: number; at: string }[]): Promise<number> {
  if (refs.length === 0) return 0
  const rows = await fetchWatchedEpisodes(tvEntryId)
  const byKey = new Map(rows.map(r => [`${r.season_number}x${r.episode_number}`, r]))
  const out = refs.flatMap(r => {
    const row = byKey.get(`${r.season}x${r.episode}`)
    const at = toIso(r.at)
    if (!row || (row.watched_at && Date.parse(row.watched_at) === Date.parse(at))) return []
    return [{ id: row.id, user_id: row.user_id, tv_entry_id: row.tv_entry_id, tv_series_id: row.tv_series_id, season_number: row.season_number, episode_number: row.episode_number, watched_at: at }]
  })
  for (let i = 0; i < out.length; i += 500) {
    const { error } = await supabase.from('user_tv_episodes').upsert(out.slice(i, i + 500), { onConflict: 'id' })
    if (error) throw error
  }
  return out.length
}

/** One more play of an already-watched episode: repeat_count + 1, last watched = that day. */
export async function rewatchEpisode(
  tvEntryId: string,
  season: number,
  episode: number,
  watchedOn: string,
): Promise<void> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('user_tv_episodes').select('id, repeat_count, watched_at')
    .eq('user_id', user.id).eq('tv_entry_id', tvEntryId)
    .eq('season_number', season).eq('episode_number', episode)
    .maybeSingle()
  if (error && (error.code === '42703' || error.code === 'PGRST204')) throw new Error('Rewatches need migration 116 (episode play counts)')
  if (error) throw error
  if (!data?.watched_at) { await markEpisodeWatched(tvEntryId, season, episode, watchedOn); return }
  const { error: upErr } = await supabase
    .from('user_tv_episodes')
    .update({ repeat_count: (data.repeat_count ?? 0) + 1, watched_at: toIso(watchedOn) })
    .eq('id', data.id)
  if (upErr) throw upErr
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

/** Per series: distinct watched episodes and plays (1 + repeat_count each), from the real rows. */
export interface EpisodeTally { episodes: number; plays: number }

export async function fetchEpisodeTally(): Promise<Record<string, EpisodeTally>> {
  const out: Record<string, EpisodeTally> = {}
  let withRepeat = true
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('user_tv_episodes')
      .select(withRepeat ? 'tv_series_id, repeat_count' : 'tv_series_id')
      .not('watched_at', 'is', null).order('id').range(from, from + 999)
    // Before migration 116 there is no repeat_count on episodes.
    if (error && withRepeat && (error.code === '42703' || error.code === 'PGRST204')) { withRepeat = false; from -= 1000; continue }
    if (error) throw error
    for (const r of (data ?? []) as unknown as { tv_series_id: string; repeat_count?: number }[]) {
      const t = out[r.tv_series_id] ?? { episodes: 0, plays: 0 }
      t.episodes += 1
      t.plays += 1 + Math.max(0, r.repeat_count ?? 0)
      out[r.tv_series_id] = t
    }
    if (!data || data.length < 1000) return out
  }
}

export interface WatchedEpisodeRow { tv_series_id: string; season_number: number; episode_number: number; watched_at: string; repeat_count: number }

/** Every watched episode row (for Year in review), paged past PostgREST's 1,000-row cap. */
export async function fetchAllWatchedEpisodeRows(): Promise<WatchedEpisodeRow[]> {
  const out: WatchedEpisodeRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('user_tv_episodes')
      .select('tv_series_id, season_number, episode_number, watched_at, repeat_count')
      .not('watched_at', 'is', null).order('id').range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as WatchedEpisodeRow[]))
    if (!data || data.length < 1000) return out
  }
}
