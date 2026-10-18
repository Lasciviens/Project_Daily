import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { middayIso } from '../watchedWhen'

// Every watch keeps its own date (migration 149): one media_watches row per
// watch of an episode or a movie. The cache columns (user_tv_episodes /
// user_movie_entries watched_at + repeat_count) follow by trigger, and every
// change reaches Trakt as that one play (the outbox triggers).

/** The columns a watch list reads (embedded in the episode / movie rows). */
export const WATCH_COLUMNS = 'id, watched_at, trakt_history_id, source, created_at'

/** Before migration 149 (no table, no relationship to embed): read without the watches. */
export const isBefore149 = (e: { code?: string } | null | undefined) =>
  ['PGRST200', 'PGRST205', '42P01', '42703', 'PGRST204'].includes(String(e?.code ?? ''))

export const NEEDS_149 = 'Each watch with its own date needs migration 149 (media_watches) — it is not applied yet'
/** A date change needs the watch it moves: before 149 it would have re-sent every play to Trakt at the new date. */
export const NEEDS_149_DATES = 'Changing a watched date needs migration 149 (each watch with its own date) — it is not applied yet, so nothing was changed'

/** A yyyy-MM-dd day (midday local), an exact ISO timestamp, or null (a movie's unknown date). */
const toIso = (v: string | null) => (v == null ? null : v.length === 10 ? middayIso(v) : v)

/** What a watch belongs to: an episode (show + season + episode) or a movie's library entry. */
export type WatchTarget =
  | { kind: 'episode'; tvSeriesId: string; season: number; episode: number }
  | { kind: 'movie'; movieEntryId: string }

function targetColumns(t: WatchTarget) {
  return t.kind === 'movie'
    ? { kind: 'movie' as const, movie_entry_id: t.movieEntryId }
    : { kind: 'episode' as const, tv_series_id: t.tvSeriesId, season_number: t.season, episode_number: t.episode }
}

/**
 * New watches, each at its own time. An episode with no watch yet becomes
 * watched (the database creates its row), a Wishlist movie Completed.
 */
export async function addWatches(items: { target: WatchTarget; at: string | null }[]): Promise<number> {
  if (items.length === 0) return 0
  const user = await requireUser()
  const rows = items.map(i => ({ user_id: user.id, ...targetColumns(i.target), watched_at: toIso(i.at) }))
  for (let i = 0; i < rows.length; i += 500) {
    // Movie and episode rows carry different columns: the missing ones are NULL.
    const { error } = await supabase.from('media_watches').insert(rows.slice(i, i + 500))
    if (error && isBefore149(error)) throw new Error(NEEDS_149)
    if (error) throw error
  }
  return rows.length
}

/**
 * New dates for chosen watches (each its own). On Trakt only that play is
 * removed and added at the new date. One upsert per 500: the database keeps
 * each watch's item, so a row can't move to another episode or movie.
 */
export async function setWatchDates(items: { id: string; target: WatchTarget; at: string | null }[]): Promise<number> {
  if (items.length === 0) return 0
  const user = await requireUser()
  const rows = items.map(i => ({ id: i.id, user_id: user.id, ...targetColumns(i.target), watched_at: toIso(i.at) }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('media_watches').upsert(rows.slice(i, i + 500), { onConflict: 'id' })
    if (error && isBefore149(error)) throw new Error(NEEDS_149)
    if (error) throw error
  }
  return rows.length
}

/** What starting a rewatch did (migration 161's app_start_rewatch). */
export interface RewatchStart {
  round: number
  /** Where the round counts from (ISO). */
  startedAt: string
  /** The round began at an earlier watch of the first episode (a pass already under way), not now. */
  pickedUp: boolean
}

/** Before migration 161 the function is missing. */
export const isBefore161 = (e: { code?: string } | null | undefined) => ['PGRST202', '42883'].includes(String(e?.code ?? ''))

/**
 * Watch a title again: Watching + the round the database plans — one more than
 * its fewest watches, counted from now, or from an earlier rewatch of the
 * first episode when a new pass is already under way. No watch changes.
 */
export async function startRewatch(kind: 'movie' | 'tv', entryId: string): Promise<RewatchStart> {
  const { data, error } = await supabase.rpc('app_start_rewatch', { p_kind: kind, p_entry: entryId })
  if (error) throw error
  const row = data as { round?: unknown; started_at?: unknown; picked_up?: unknown } | null
  if (typeof row?.round !== 'number' || typeof row.started_at !== 'string') throw new Error('Starting a rewatch gave no round back')
  return { round: row.round, startedAt: row.started_at, pickedUp: row.picked_up === true }
}
