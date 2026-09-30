// trakt-api — the app's door to Trakt (docs/trakt/PLAN.md).
//
// Connect (OAuth code exchange), status, disconnect (revoke), a read-only
// `snapshot` of everything Trakt holds, and `push` — the app → Trakt writes
// of an import (history, ratings, watchlist add/remove), paced at Trakt's
// one write per second. The media tables are written by the browser
// (src/features/media/trakt/traktImport.ts, planned by the pure
// traktImportPlan.ts); this function only ever writes trakt_tokens and
// trakt_sync_state.
//
// `verify_jwt` stays ON: every action resolves the caller with
// `supabase.auth.getUser` (the psn-api / calendar-oauth pattern) and the
// service-role client reads/writes `trakt_tokens` for that user only. The
// Client Secret never leaves this function.
//
// Trakt facts this relies on (checked against the API blueprint, 30.09.2026):
// access tokens last 24 h (since 20.03.2025) and are refreshed from the
// refresh token; GET is limited to 1,000 calls / 5 min per user; paginated
// endpoints report X-Pagination-Page-Count.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type AnyRec = Record<string, unknown>
type Action = 'authorize_url' | 'connect' | 'status' | 'disconnect' | 'snapshot' | 'push'

const API = 'https://api.trakt.tv'
const AUTHORIZE = 'https://trakt.tv/oauth/authorize'
const CLIENT_ID = () => Deno.env.get('TRAKT_CLIENT_ID') ?? ''
const CLIENT_SECRET = () => Deno.env.get('TRAKT_CLIENT_SECRET') ?? ''
// The only places Trakt may send the user back to (the Trakt app's own list).
const REDIRECTS = ['https://lasciviens.github.io/Project_Daily/', 'http://localhost:5173/Project_Daily/']

class TraktError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

function headers(token?: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': CLIENT_ID(),
    'User-Agent': 'LascisBoard/1.0',
  }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function oauth(path: string, body: AnyRec): Promise<AnyRec> {
  const res = await fetch(`${API}${path}`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) throw new TraktError(res.status, `Trakt ${path} ${res.status}`)
  return text ? JSON.parse(text) : {}
}

async function get(path: string, token: string): Promise<{ data: unknown; pages: number }> {
  const res = await fetch(`${API}${path}`, { headers: headers(token) })
  if (res.status === 429) throw new TraktError(429, 'Trakt rate limit reached — try again in a few minutes')
  if (!res.ok) throw new TraktError(res.status, `Trakt ${path.split('?')[0]} ${res.status}`)
  const pages = Number(res.headers.get('X-Pagination-Page-Count') ?? '1') || 1
  return { data: await res.json(), pages }
}

/** Every page of a (possibly) paginated endpoint. */
async function getAll(path: string, token: string, limit = 250): Promise<AnyRec[]> {
  const sep = path.includes('?') ? '&' : '?'
  const first = await get(`${path}${sep}page=1&limit=${limit}`, token)
  const out = [...(first.data as AnyRec[] ?? [])]
  for (let page = 2; page <= Math.min(first.pages, 200); page++) {
    const next = await get(`${path}${sep}page=${page}&limit=${limit}`, token)
    out.push(...(next.data as AnyRec[] ?? []))
  }
  return out
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** One write. Trakt allows 1 POST per second; a 429 waits Retry-After once. */
async function post(path: string, token: string, body: AnyRec): Promise<AnyRec> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { method: 'POST', headers: headers(token), body: JSON.stringify(body) })
    if (res.status === 429 && attempt === 0) {
      await sleep((Number(res.headers.get('Retry-After')) || 2) * 1000)
      continue
    }
    if (!res.ok) throw new TraktError(res.status, `Trakt ${path} ${res.status}`)
    const text = await res.text()
    await sleep(1100)
    return text ? JSON.parse(text) : {}
  }
}

interface PushTitle { tmdb: number; watchedAt?: string | null; rating?: number }
interface PushEpisode { tmdb: number; season: number; episode: number; watchedAt: string | null }
interface PushBody {
  history?: { movies?: PushTitle[]; episodes?: PushEpisode[] }
  ratings?: { movies?: PushTitle[]; shows?: PushTitle[] }
  watchlistAdd?: { movies?: PushTitle[]; shows?: PushTitle[] }
  watchlistRemove?: { movies?: PushTitle[]; shows?: PushTitle[] }
}

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}
const tmdbIds = (tmdb: number) => ({ ids: { tmdb } })

function showsWithEpisodes(eps: PushEpisode[]): AnyRec[] {
  const byShow = new Map<number, Map<number, AnyRec[]>>()
  for (const e of eps) {
    const seasons = byShow.get(e.tmdb) ?? new Map<number, AnyRec[]>()
    const list = seasons.get(e.season) ?? []
    list.push({ number: e.episode, ...(e.watchedAt ? { watched_at: e.watchedAt } : {}) })
    seasons.set(e.season, list)
    byShow.set(e.tmdb, seasons)
  }
  return [...byShow].map(([tmdb, seasons]) => ({
    ...tmdbIds(tmdb),
    seasons: [...seasons].map(([number, episodes]) => ({ number, episodes })),
  }))
}

/** Sends one import's app → Trakt changes; returns what Trakt added and could not find. */
async function push(token: string, b: PushBody) {
  const tally: Record<string, number> = {}
  const count = (res: AnyRec, key: 'added' | 'deleted' | 'not_found', label: string) => {
    const part = (res[key] ?? {}) as AnyRec
    for (const [k, v] of Object.entries(part)) {
      const n = Array.isArray(v) ? v.length : Number(v) || 0
      if (n) { const t = `${label}.${key}.${k}`; tally[t] = (tally[t] ?? 0) + n }
    }
  }
  const movies = b.history?.movies ?? []
  for (const part of chunk(movies, 100)) {
    count(await post('/sync/history', token, { movies: part.map(m => ({ ...tmdbIds(m.tmdb), ...(m.watchedAt ? { watched_at: m.watchedAt } : {}) })) }), 'added', 'history')
  }
  for (const part of chunk(showsWithEpisodes(b.history?.episodes ?? []), 20)) {
    count(await post('/sync/history', token, { shows: part }), 'added', 'history')
  }
  const rated = [...(b.ratings?.movies ?? []).map(m => ['movies', m] as const), ...(b.ratings?.shows ?? []).map(m => ['shows', m] as const)]
  for (const part of chunk(rated, 100)) {
    const body: AnyRec = { movies: [], shows: [] }
    for (const [k, t] of part) (body[k] as AnyRec[]).push({ ...tmdbIds(t.tmdb), rating: t.rating })
    count(await post('/sync/ratings', token, body), 'added', 'ratings')
  }
  for (const [key, path, label] of [['watchlistAdd', '/sync/watchlist', 'watchlist'], ['watchlistRemove', '/sync/watchlist/remove', 'unwatchlist']] as const) {
    const w = b[key]
    const all = [...(w?.movies ?? []).map(t => ['movies', t] as const), ...(w?.shows ?? []).map(t => ['shows', t] as const)]
    for (const part of chunk(all, 100)) {
      const body: AnyRec = { movies: [], shows: [] }
      for (const [k, t] of part) (body[k] as AnyRec[]).push(tmdbIds(t.tmdb))
      const res = await post(path, token, body)
      count(res, key === 'watchlistAdd' ? 'added' : 'deleted', label)
      count(res, 'not_found', label)
    }
  }
  return tally
}

// ── Normalising Trakt's objects into the compact snapshot shape ─────────────
// (mirrors src/features/media/trakt/traktTypes.ts)
function ids(o: AnyRec | undefined) {
  const i = (o?.ids ?? {}) as AnyRec
  return {
    trakt: Number(i.trakt) || 0,
    slug: typeof i.slug === 'string' ? i.slug : null,
    tmdb: Number(i.tmdb) || null,
    imdb: typeof i.imdb === 'string' && i.imdb ? i.imdb : null,
    tvdb: Number(i.tvdb) || null,
  }
}
function item(type: 'movie' | 'show', o: AnyRec | undefined) {
  return { type, ids: ids(o), title: String(o?.title ?? 'Untitled'), year: Number(o?.year) || null }
}
function mediaOf(row: AnyRec) {
  if (row.movie) return item('movie', row.movie as AnyRec)
  if (row.show) return item('show', row.show as AnyRec)
  return null
}

async function snapshot(token: string, username: string | null) {
  const [
    lastActivities, watchedMovies, watchedShows, wlMovies, wlShows,
    rMovies, rShows, favMovies, favShows, dropped, pbMovies, pbEpisodes,
  ] = await Promise.all([
    get('/sync/last_activities', token).then(r => r.data),
    // Since 03.07.2026 the watched endpoints are paginated (100 items without
    // a limit) and leave out seasons unless asked: extended=progress, which
    // caps a page at 100 (trakt/trakt-api discussion #775).
    getAll('/sync/watched/movies', token),
    getAll('/sync/watched/shows?extended=progress', token, 100),
    getAll('/sync/watchlist/movies/rank/asc', token),
    getAll('/sync/watchlist/shows/rank/asc', token),
    getAll('/sync/ratings/movies', token),
    getAll('/sync/ratings/shows', token),
    getAll('/sync/favorites/movies/rank/asc', token),
    getAll('/sync/favorites/shows/rank/asc', token),
    getAll('/users/hidden/dropped?type=show', token, 100),
    get('/sync/playback/movies', token).then(r => r.data as AnyRec[]),
    get('/sync/playback/episodes', token).then(r => r.data as AnyRec[]),
  ])

  return {
    fetchedAt: new Date().toISOString(),
    username,
    lastActivities,
    watchedMovies: (watchedMovies ?? []).map(r => ({
      item: item('movie', r.movie as AnyRec),
      plays: Number(r.plays) || 1,
      lastWatchedAt: (r.last_watched_at as string) ?? null,
    })),
    watchedShows: (watchedShows ?? []).map(r => ({
      item: item('show', r.show as AnyRec),
      plays: Number(r.plays) || 0,
      lastWatchedAt: (r.last_watched_at as string) ?? null,
      resetAt: (r.reset_at as string) ?? null,
      // [season, episode, plays, lastWatchedAt] — tuples keep a long show small.
      episodes: ((r.seasons as AnyRec[]) ?? []).flatMap(s =>
        ((s.episodes as AnyRec[]) ?? []).map(e => [
          Number(s.number) || 0, Number(e.number) || 0, Number(e.plays) || 1, (e.last_watched_at as string) ?? null,
        ])),
    })),
    watchlist: [...wlMovies, ...wlShows].map(r => ({
      item: mediaOf(r), rank: Number(r.rank) || null, listedAt: (r.listed_at as string) ?? null,
    })).filter(r => r.item),
    ratings: [...(rMovies ?? []), ...(rShows ?? [])].map(r => ({
      item: mediaOf(r), rating: Number(r.rating) || null, ratedAt: (r.rated_at as string) ?? null,
    })).filter(r => r.item && r.rating),
    favorites: [...favMovies, ...favShows].map(r => ({ item: mediaOf(r), listedAt: (r.listed_at as string) ?? null })).filter(r => r.item),
    dropped: dropped.map(r => ({ item: mediaOf(r) })).filter(r => r.item),
    playback: [
      ...(pbMovies ?? []).map(r => ({ item: item('movie', r.movie as AnyRec), season: null, episode: null,
        progress: Number(r.progress) || 0, pausedAt: (r.paused_at as string) ?? null })),
      ...(pbEpisodes ?? []).map(r => {
        const ep = (r.episode ?? {}) as AnyRec
        return { item: item('show', r.show as AnyRec), season: Number(ep.season) || 0, episode: Number(ep.number) || 0,
          progress: Number(r.progress) || 0, pausedAt: (r.paused_at as string) ?? null }
      }),
    ],
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return json({ error: 'Missing authorization header' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) return json({ error: 'Invalid token' }, 401)
  const userId = user.id

  let body: { action?: Action; code?: string; redirectUri?: string; state?: string; changes?: PushBody; full?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }
  const { action } = body

  if (!CLIENT_ID() || !CLIENT_SECRET()) return json({ error: 'not_configured' }, 200)

  try {
    if (action === 'authorize_url') {
      const redirectUri = body.redirectUri ?? ''
      if (!REDIRECTS.includes(redirectUri)) return json({ error: 'redirect_not_allowed' }, 400)
      const url = `${AUTHORIZE}?response_type=code&client_id=${encodeURIComponent(CLIENT_ID())}`
        + `&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(body.state ?? '')}`
      return json({ url })
    }

    if (action === 'connect') {
      const redirectUri = body.redirectUri ?? ''
      if (!body.code) return json({ error: 'code required' }, 400)
      if (!REDIRECTS.includes(redirectUri)) return json({ error: 'redirect_not_allowed' }, 400)
      const t = await oauth('/oauth/token', {
        code: body.code, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(),
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      })
      const accessToken = String(t.access_token ?? '')
      if (!accessToken) throw new Error('Trakt returned no access token')
      let username: string | null = null
      try {
        const s = (await get('/users/settings', accessToken)).data as AnyRec
        username = ((s.user as AnyRec)?.username as string) ?? null
      } catch { /* the name is only shown on the card */ }
      const expiresAt = new Date(Date.now() + (Number(t.expires_in) || 86400) * 1000).toISOString()
      const { error } = await supabase.from('trakt_tokens').upsert({
        user_id: userId, access_token: accessToken, refresh_token: String(t.refresh_token ?? ''),
        expires_at: expiresAt, username, connected_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      })
      if (error) throw error
      return json({ connected: true, username })
    }

    const { data: row, error: readError } = await supabase.from('trakt_tokens').select('*').eq('user_id', userId).maybeSingle()
    if (readError) throw readError
    const tok = row as AnyRec | null

    if (action === 'status') {
      const { data: state } = await supabase.from('trakt_sync_state').select('last_sync_at, last_error').eq('user_id', userId).maybeSingle()
      return json({
        connected: !!tok,
        username: tok?.username ?? null,
        connectedAt: tok?.connected_at ?? null,
        lastSyncAt: (state as AnyRec | null)?.last_sync_at ?? null,
      })
    }

    if (action === 'disconnect') {
      if (tok) {
        // Revoke on Trakt first; a failed revoke still removes our copy.
        await oauth('/oauth/revoke', { token: tok.access_token, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET() }).catch(() => null)
        const { error } = await supabase.from('trakt_tokens').delete().eq('user_id', userId)
        if (error) throw error
      }
      return json({ connected: false })
    }

    if (!tok) return json({ error: 'not_connected' }, 400)

    // Refresh a token that expires within 10 minutes.
    let accessToken = String(tok.access_token)
    if (new Date(String(tok.expires_at)).getTime() - Date.now() < 10 * 60 * 1000) {
      const t = await oauth('/oauth/token', {
        refresh_token: tok.refresh_token, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(),
        redirect_uri: REDIRECTS[0], grant_type: 'refresh_token',
      })
      accessToken = String(t.access_token)
      const { error } = await supabase.from('trakt_tokens').update({
        access_token: accessToken,
        refresh_token: String(t.refresh_token ?? tok.refresh_token),
        expires_at: new Date(Date.now() + (Number(t.expires_in) || 86400) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('user_id', userId)
      if (error) throw error
    }

    if (action === 'snapshot') {
      return json(await snapshot(accessToken, (tok.username as string) ?? null))
    }

    if (action === 'push') {
      let tally: Record<string, number> = {}
      let pushError: string | null = null
      try { tally = await push(accessToken, body.changes ?? {}) } catch (e) { pushError = e instanceof Error ? e.message : String(e) }
      // Stamp the run either way, so the next sync knows where it stands.
      const now = new Date().toISOString()
      const lastActivities = await get('/sync/last_activities', accessToken).then(r => r.data).catch(() => null)
      const { error } = await supabase.from('trakt_sync_state').upsert({
        user_id: userId, last_sync_at: now, ...(body.full ? { last_full_at: now } : {}),
        ...(lastActivities ? { last_activities: lastActivities } : {}), last_error: pushError, updated_at: now,
      })
      if (error) throw error
      if (pushError) return json({ error: `Saved here, but sending to Trakt failed: ${pushError}`, tally })
      return json({ tally })
    }

    return json({ error: `Unknown action: ${action}` }, 400)
  } catch (err) {
    const status = err instanceof TraktError ? err.status : 500
    // A revoked/expired grant: the user must reconnect.
    if (status === 401) return json({ error: 'reauth_required' }, 200)
    const message = err instanceof Error ? err.message : String(err)
    return json({ error: message }, status >= 400 && status < 600 ? status : 500)
  }
})
