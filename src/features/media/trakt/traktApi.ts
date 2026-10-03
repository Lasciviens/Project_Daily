import { supabase } from '../../../integrations/supabase/client'
import { parseFunctionErrorBody } from '../../../shared/utils/functionError'
import { DetailedError } from '../../../shared/utils/errorReport'
import type { LocalEpisode, LocalLibrary, LocalMovie, LocalShow, TraktSnapshot, TraktStatus } from './traktTypes'

// Browser side of the trakt-api edge function. The Client Secret and the
// tokens never reach the browser; this only ever sees status and the snapshot.

export class TraktReauthRequired extends Error {
  constructor() { super('Trakt needs to be connected again') }
}

async function invoke<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const res = await supabase.functions.invoke('trakt-api', { body: { action, ...extra } })
  let data = res.data
  let httpStatus: number | undefined
  if (res.error) {
    // A non-2xx answer: show the function's own message, not supabase-js's
    // generic "Edge Function returned a non-2xx status code".
    httpStatus = (res.error as { context?: { status?: number } }).context?.status
    const body = await parseFunctionErrorBody(res.error)
    if (!body?.error) throw new DetailedError(res.error.message, { action, httpStatus })
    data = body
  }
  if (data?.error === 'reauth_required') throw new TraktReauthRequired()
  if (data?.error === 'not_configured') throw new Error('Trakt is not set up on the server yet (TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET)')
  if (data?.error) throw new DetailedError(String(data.error), { action, httpStatus, detail: data.detail })
  return data as T
}

/** Where Trakt sends you back — must be on the Trakt app's Redirect URI list. */
export function traktRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`
}

export async function fetchTraktStatus(): Promise<TraktStatus> {
  const { data, error } = await supabase.functions.invoke('trakt-api', { body: { action: 'status' } })
  if (error) throw error
  if (data?.error === 'not_configured') return { connected: false, username: null, connectedAt: null, lastSyncAt: null, pending: 0, notConfigured: true }
  if (data?.error) throw new Error(data.error)
  return data as TraktStatus
}

export function traktAuthorizeUrl(state: string): Promise<{ url: string }> {
  return invoke('authorize_url', { redirectUri: traktRedirectUri(), state })
}

export function connectTrakt(code: string): Promise<{ connected: true; username: string | null }> {
  return invoke('connect', { code, redirectUri: traktRedirectUri() })
}

export async function disconnectTrakt(): Promise<void> {
  await invoke('disconnect')
}

export function fetchTraktSnapshot(): Promise<TraktSnapshot> {
  return invoke('snapshot')
}

export interface TraktRunResult {
  kind: 'import' | 'sync'
  at: string
  busy?: boolean
  pulled?: boolean
  drained?: { sent: number; notFound: number; failed: number; left: number; error: string | null }
  applied?: { movies: number; shows: number; episodes: number; removed: number; skippedNew: number } | null
  heldBack?: number
  kept?: number
  sent?: number
}

/**
 * One sync: the app's queued changes go to Trakt first, then Trakt is read
 * back and mirrored (only when it changed). `full` reads Trakt even when
 * nothing changed; `force` applies removals a big sync held back.
 */
export function syncTrakt(opts: { full?: boolean; force?: boolean } = {}): Promise<TraktRunResult> {
  return invoke('sync', opts)
}

/** The first import, run on the server: Trakt → library, then the app-only facts → Trakt. */
export function importTrakt(): Promise<TraktRunResult> {
  return invoke('import')
}

// ── The library slice the preview compares with ─────────────────────────────
const yearOf = (d: string | null | undefined) => (d ? Number(d.slice(0, 4)) || null : null)
const missingColumn = (e: { code?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204')

type Row = Record<string, unknown>
const one = (v: unknown): Row | null => (Array.isArray(v) ? (v[0] as Row) ?? null : (v as Row) ?? null)

async function fetchWatchedEpisodes(): Promise<LocalEpisode[]> {
  const out: LocalEpisode[] = []
  let withRepeat = true
  for (let from = 0; ; from += 1000) {
    const cols = `season_number, episode_number, watched_at, ${withRepeat ? 'repeat_count, ' : ''}tv_series:tv_series(tmdb_id)`
    const { data, error } = await supabase.from('user_tv_episodes').select(cols)
      .not('watched_at', 'is', null).order('id').range(from, from + 999)
    // Before migration 116 there is no repeat_count on episodes: read without it.
    if (missingColumn(error) && withRepeat) { withRepeat = false; from -= 1000; continue }
    if (error) throw error
    for (const r of (data ?? []) as unknown as Row[]) {
      const tmdb = Number(one(r.tv_series)?.tmdb_id)
      if (tmdb) out.push({ tmdbId: tmdb, season: Number(r.season_number), episode: Number(r.episode_number), repeatCount: Number(r.repeat_count) || 0, watchedAt: (r.watched_at as string) ?? null })
    }
    if (!data || data.length < 1000) return out
  }
}

export async function fetchLocalLibraryForTrakt(): Promise<LocalLibrary> {
  const [mv, tv, episodes] = await Promise.all([
    supabase.from('user_movie_entries').select('status, repeat_count, rating, watched_at, movie:movies(tmdb_id, title, release_date)'),
    supabase.from('user_tv_entries').select('status, rating, tv_series:tv_series(tmdb_id, title, first_air_date)'),
    fetchWatchedEpisodes(),
  ])
  if (mv.error) throw mv.error
  if (tv.error) throw tv.error
  const movies: LocalMovie[] = ((mv.data ?? []) as unknown as Row[]).flatMap(r => {
    const m = one(r.movie)
    const tmdbId = Number(m?.tmdb_id)
    return tmdbId ? [{ tmdbId, title: String(m?.title ?? ''), year: yearOf(m?.release_date as string), status: String(r.status), repeatCount: Number(r.repeat_count) || 0, rating: (r.rating as number) ?? null, watchedAt: (r.watched_at as string) ?? null }] : []
  })
  const shows: LocalShow[] = ((tv.data ?? []) as unknown as Row[]).flatMap(r => {
    const s = one(r.tv_series)
    const tmdbId = Number(s?.tmdb_id)
    return tmdbId ? [{ tmdbId, title: String(s?.title ?? ''), year: yearOf(s?.first_air_date as string), status: String(r.status), rating: (r.rating as number) ?? null }] : []
  })
  return { movies, shows, episodes }
}

// ── Phase 5/6 reads and list writes ─────────────────────────────────────────

export interface MediaScores {
  rt_critics: number | null
  rt_audience: number | null
  metacritic: number | null
  imdb_rating: number | null
  letterboxd_rating: number | null
  rt_url: string | null
}

/** Rotten Tomatoes / Metacritic / IMDb / Letterboxd for one title (MDBList, via trakt-api). */
export async function fetchMediaScores(mediaType: 'movie' | 'tv', tmdbId: number): Promise<MediaScores | null> {
  const { data, error } = await supabase.functions.invoke('trakt-api', { body: { action: 'ratings', mediaType, tmdbId } })
  if (error) {
    const body = await parseFunctionErrorBody(error)
    throw new Error(body?.error ?? error.message)
  }
  if (data?.error === 'not_configured') return null
  if (data?.error) throw new Error(data.error)
  return (data?.scores ?? null) as MediaScores | null
}

export interface TraktPlaybackItem {
  id: number
  progress: number
  pausedAt: string | null
  type: 'movie' | 'episode'
  tmdb: number | null
  title: string
  season: number | null
  episode: number | null
  episodeTitle: string | null
}

export interface TraktCalendarItem {
  firstAired: string | null
  season: number | null
  episode: number | null
  episodeTitle: string | null
  showTitle: string
  tmdb: number | null
}

export interface TraktList {
  id: number
  slug: string
  name: string
  description: string | null
  privacy: string
  itemCount: number
  updatedAt: string | null
}

export interface TraktListItem {
  listItemId: number
  rank: number | null
  type: 'movie' | 'show'
  tmdb: number | null
  title: string
  year: number | null
  listedAt: string | null
  posterPath: string | null
}

export interface ListItemRef { type: 'movie' | 'show'; tmdb: number }

export const fetchTraktPlayback = () => invoke<{ items: TraktPlaybackItem[] }>('playback').then(r => r.items)
/** Drops one paused playback from Trakt (Continue watching). */
export const removeTraktPlayback = (id: number) => invoke<{ ok: true }>('playback_remove', { id })
export const fetchTraktCalendar = () => invoke<{ items: TraktCalendarItem[] }>('calendar').then(r => r.items)
export const fetchTraktLists = () => invoke<{ lists: TraktList[] }>('lists').then(r => r.lists)
export const fetchTraktListItems = (listId: number) => invoke<{ items: TraktListItem[] }>('list_items', { listId }).then(r => r.items)
export const createTraktList = (name: string, description?: string) => invoke<{ list: TraktList }>('list_create', { name, description }).then(r => r.list)
export const deleteTraktList = (listId: number) => invoke<{ deleted: true }>('list_delete', { listId })
export const addToTraktList = (listId: number, items: ListItemRef[]) => invoke<{ notFound: number }>('list_add', { listId, items })
export const removeFromTraktList = (listId: number, items: ListItemRef[]) => invoke<{ notFound: number }>('list_remove', { listId, items })
/** Every list item id of the list, in the new order. */
export const reorderTraktList = (listId: number, rank: number[]) => invoke<{ updated: number | null; skipped: number[] }>('list_reorder', { listId, rank })
