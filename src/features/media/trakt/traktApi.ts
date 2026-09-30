import { supabase } from '../../../integrations/supabase/client'
import type { LocalEpisode, LocalLibrary, LocalMovie, LocalShow, TraktSnapshot, TraktStatus } from './traktTypes'

// Browser side of the trakt-api edge function. The Client Secret and the
// tokens never reach the browser; this only ever sees status and the snapshot.

export class TraktReauthRequired extends Error {
  constructor() { super('Trakt needs to be connected again') }
}

async function invoke<T>(action: string, extra?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('trakt-api', { body: { action, ...extra } })
  if (error) throw error
  if (data?.error === 'reauth_required') throw new TraktReauthRequired()
  if (data?.error === 'not_configured') throw new Error('Trakt is not set up on the server yet (TRAKT_CLIENT_ID / TRAKT_CLIENT_SECRET)')
  if (data?.error) throw new Error(data.error)
  return data as T
}

/** Where Trakt sends you back — must be on the Trakt app's Redirect URI list. */
export function traktRedirectUri(): string {
  return `${window.location.origin}${window.location.pathname}`
}

export async function fetchTraktStatus(): Promise<TraktStatus> {
  const { data, error } = await supabase.functions.invoke('trakt-api', { body: { action: 'status' } })
  if (error) throw error
  if (data?.error === 'not_configured') return { connected: false, username: null, connectedAt: null, lastSyncAt: null, notConfigured: true }
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

// ── The library slice the preview compares with ─────────────────────────────
const yearOf = (d: string | null | undefined) => (d ? Number(d.slice(0, 4)) || null : null)
const missingColumn = (e: { code?: string } | null) => !!e && (e.code === '42703' || e.code === 'PGRST204')

type Row = Record<string, unknown>
const one = (v: unknown): Row | null => (Array.isArray(v) ? (v[0] as Row) ?? null : (v as Row) ?? null)

async function fetchWatchedEpisodes(): Promise<LocalEpisode[]> {
  const out: LocalEpisode[] = []
  let withRepeat = true
  for (let from = 0; ; from += 1000) {
    const cols = `season_number, episode_number, ${withRepeat ? 'repeat_count, ' : ''}tv_series:tv_series(tmdb_id)`
    const { data, error } = await supabase.from('user_tv_episodes').select(cols)
      .not('watched_at', 'is', null).order('id').range(from, from + 999)
    // Before migration 116 there is no repeat_count on episodes: read without it.
    if (missingColumn(error) && withRepeat) { withRepeat = false; from -= 1000; continue }
    if (error) throw error
    for (const r of (data ?? []) as unknown as Row[]) {
      const tmdb = Number(one(r.tv_series)?.tmdb_id)
      if (tmdb) out.push({ tmdbId: tmdb, season: Number(r.season_number), episode: Number(r.episode_number), repeatCount: Number(r.repeat_count) || 0 })
    }
    if (!data || data.length < 1000) return out
  }
}

export async function fetchLocalLibraryForTrakt(): Promise<LocalLibrary> {
  const [mv, tv, episodes] = await Promise.all([
    supabase.from('user_movie_entries').select('status, repeat_count, rating, movie:movies(tmdb_id, title, release_date)'),
    supabase.from('user_tv_entries').select('status, rating, tv_series:tv_series(tmdb_id, title, first_air_date)'),
    fetchWatchedEpisodes(),
  ])
  if (mv.error) throw mv.error
  if (tv.error) throw tv.error
  const movies: LocalMovie[] = ((mv.data ?? []) as unknown as Row[]).flatMap(r => {
    const m = one(r.movie)
    const tmdbId = Number(m?.tmdb_id)
    return tmdbId ? [{ tmdbId, title: String(m?.title ?? ''), year: yearOf(m?.release_date as string), status: String(r.status), repeatCount: Number(r.repeat_count) || 0, rating: (r.rating as number) ?? null }] : []
  })
  const shows: LocalShow[] = ((tv.data ?? []) as unknown as Row[]).flatMap(r => {
    const s = one(r.tv_series)
    const tmdbId = Number(s?.tmdb_id)
    return tmdbId ? [{ tmdbId, title: String(s?.title ?? ''), year: yearOf(s?.first_air_date as string), status: String(r.status), rating: (r.rating as number) ?? null }] : []
  })
  return { movies, shows, episodes }
}
