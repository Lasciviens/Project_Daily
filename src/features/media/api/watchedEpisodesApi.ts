import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type { WatchedEpisode } from '../types'
import { middayIso } from '../watchedWhen'
import { addWatches, isBefore149, NEEDS_149, setWatchDates, WATCH_COLUMNS } from './watchesApi'

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

/** Each watched episode with its watches (migration 149; without them before it). */
export async function fetchWatchedEpisodes(tvEntryId: string): Promise<WatchedEpisode[]> {
  // Paged past PostgREST's 1,000-row cap (a long-running show can pass it).
  const page = (cols: string, from: number) => supabase
    .from('user_tv_episodes')
    .select(cols)
    .eq('tv_entry_id', tvEntryId)
    .not('watched_at', 'is', null)
    .order('season_number', { ascending: true })
    .order('episode_number', { ascending: true })
    .range(from, from + 999)
  // Fallback (remove once 149 has run everywhere): an older schema has no watches to embed.
  let cols = `*, watches:media_watches(${WATCH_COLUMNS})`
  const out: WatchedEpisode[] = []
  for (let from = 0; ; from += 1000) {
    let { data, error } = await page(cols, from)
    if (error && isBefore149(error) && cols !== '*') { cols = '*'; ({ data, error } = await page(cols, from)) }
    if (error) throw error
    const rows = (data ?? []) as unknown as WatchedEpisode[]
    out.push(...rows)
    if (rows.length < 1000) return out
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
  // rewatchEpisodes, which adds a watch instead. A first watch is this row:
  // the database gives it its watch (migration 149).
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
 * Before migration 149 only: change the one date an episode kept (every play
 * of it moved). With 149 a date change names the watch it moves
 * (watchesApi.setWatchDates) and Trakt loses no other play.
 */
export async function setEpisodesWatchedAtBefore149(tvEntryId: string, refs: { season: number; episode: number; at: string }[]): Promise<number> {
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

/**
 * One more watch of each episode, at its own time (Watched again, a rewatch
 * round). Every other watch keeps its date; an episode not watched yet gets
 * its first. Before migration 149 the old way: plays + 1, the kept date moves.
 */
export async function rewatchEpisodes(tvEntryId: string, refs: { season: number; episode: number; at: string }[]): Promise<void> {
  if (refs.length === 0) return
  const tvSeriesId = await resolveTvSeriesId(tvEntryId)
  try {
    await addWatches(refs.map(r => ({ target: { kind: 'episode' as const, tvSeriesId, season: r.season, episode: r.episode }, at: toIso(r.at) })))
  } catch (e) {
    if (!(e instanceof Error) || e.message !== NEEDS_149) throw e
    for (const r of refs) await rewatchEpisodeBefore149(tvEntryId, r.season, r.episode, r.at)
  }
}

/** Before migration 149: one more play = repeat_count + 1, the kept date = that day. */
async function rewatchEpisodeBefore149(tvEntryId: string, season: number, episode: number, watchedOn: string): Promise<void> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('user_tv_episodes').select('id, repeat_count, watched_at')
    .eq('user_id', user.id).eq('tv_entry_id', tvEntryId)
    .eq('season_number', season).eq('episode_number', episode)
    .maybeSingle()
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

export interface WatchedEpisodeRow {
  tv_series_id: string; season_number: number; episode_number: number; watched_at: string; repeat_count: number
  /** Each watch's own date (migration 149); absent before it. */
  watches?: { watched_at: string }[]
}

/** Every watched episode row with its watches (for Stats), paged past PostgREST's 1,000-row cap. */
export async function fetchAllWatchedEpisodeRows(): Promise<WatchedEpisodeRow[]> {
  const page = (cols: string, from: number) => supabase.from('user_tv_episodes')
    .select(cols).not('watched_at', 'is', null).order('id').range(from, from + 999)
  // Fallback (remove once 149 has run everywhere): no watches to embed before it.
  const plain = 'tv_series_id, season_number, episode_number, watched_at, repeat_count'
  let cols = `${plain}, watches:media_watches(watched_at)`
  const out: WatchedEpisodeRow[] = []
  for (let from = 0; ; from += 1000) {
    let { data, error } = await page(cols, from)
    if (error && isBefore149(error) && cols !== plain) { cols = plain; ({ data, error } = await page(cols, from)) }
    if (error) throw error
    const rows = (data ?? []) as unknown as WatchedEpisodeRow[]
    out.push(...rows)
    if (rows.length < 1000) return out
  }
}

/**
 * New dates for chosen watches of episodes (each its own — on Trakt only that
 * play moves). Before migration 149 (no watch ids on screen) the episode's
 * one kept date changes instead.
 */
export async function setEpisodeWatchDates(tvEntryId: string, changes: { season: number; episode: number; at: string; watchId?: string | null }[]): Promise<number> {
  if (changes.length === 0) return 0
  if (changes.some(c => !c.watchId)) return setEpisodesWatchedAtBefore149(tvEntryId, changes)
  const tvSeriesId = await resolveTvSeriesId(tvEntryId)
  return setWatchDates(changes.map(c => ({ id: c.watchId!, target: { kind: 'episode' as const, tvSeriesId, season: c.season, episode: c.episode }, at: toIso(c.at) })))
}
