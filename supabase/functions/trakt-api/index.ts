// trakt-api — the app's door to Trakt (docs/trakt/PLAN.md).
//
// Connect (OAuth code exchange), status, disconnect (revoke), a read-only
// `snapshot` of everything Trakt holds, `import` (the first import: Trakt →
// library, then the app-only facts → Trakt) and `sync` (phases 3–4):
//   1. send the outbox — every app change to a Trakt-held fact, queued by the
//      migration-117 triggers — oldest first, at Trakt's one write per second;
//   2. read GET /sync/last_activities; only when something changed, read
//      Trakt and mirror it into the library (additions AND removals), leaving
//      alone any item whose change is still waiting in the outbox.
// The plans are pure modules in src/features/media/trakt/, GENERATED into the
// shared region further down by scripts/sync-trakt-shared.mjs. Library writes
// go through a client that sends `x-trakt-sync: 1`, which the outbox triggers
// skip, so the sync never queues its own writes.
//
// Auth (verify_jwt OFF, checked here): a browser user JWT (resolved with
// `supabase.auth.getUser`, the psn-api / calendar-oauth pattern), or the cron's
// `x-sync-secret: <TRAKT_SYNC_SECRET>`, which acts as HEVY_USER_ID and may only
// run `sync`. The service-role client reads/writes `trakt_tokens` for that user
// only; the Client Secret never leaves this function. New titles need
// TMDB_API_KEY (the same key as the app's VITE_TMDB_API_KEY).
//
// Trakt facts this relies on (checked against the API blueprint, 30.09.2026):
// access tokens last 24 h (since 20.03.2025) and are refreshed from the
// refresh token; GET is limited to 1,000 calls / 5 min per user, POST to one
// per second; paginated endpoints report X-Pagination-Page-Count.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-sync-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

type AnyRec = Record<string, unknown>
type Action = 'authorize_url' | 'connect' | 'status' | 'disconnect' | 'snapshot' | 'import' | 'sync'

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
  droppedAdd?: { shows?: PushTitle[] }
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

/** Sends an import's app → Trakt changes; returns what Trakt added and could not find. */
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
  // Trakt's hidden "dropped" section takes shows only (API blueprint, Add Hidden Items).
  for (const part of chunk(b.droppedAdd?.shows ?? [], 100)) {
    const res = await post('/users/hidden/dropped', token, { shows: part.map(t => tmdbIds(t.tmdb)) })
    count(res, 'added', 'dropped')
    count(res, 'not_found', 'dropped')
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

// <trakt-shared>
// GENERATED from src/features/media/trakt/ by scripts/sync-trakt-shared.mjs.
// Do not edit here — edit the source and re-run the script.

// ── traktTypes.ts ──
// The shapes trakt-api's `snapshot` action returns (mirrors
// supabase/functions/trakt-api/index.ts) and the library slice the preview
// compares them with. Type-only, so scripts can load the pure modules.

interface TraktIds {
  trakt: number
  slug: string | null
  tmdb: number | null
  imdb: string | null
  tvdb: number | null
}

interface TraktItem {
  type: 'movie' | 'show'
  ids: TraktIds
  title: string
  year: number | null
}

/** [season, episode, plays, lastWatchedAt] */
type TraktEpisodeTuple = [number, number, number, string | null]

interface TraktSnapshot {
  fetchedAt: string
  username: string | null
  lastActivities: unknown
  watchedMovies: { item: TraktItem; plays: number; lastWatchedAt: string | null }[]
  watchedShows: { item: TraktItem; plays: number; lastWatchedAt: string | null; resetAt: string | null; episodes: TraktEpisodeTuple[] }[]
  watchlist: { item: TraktItem; rank: number | null; listedAt: string | null }[]
  ratings: { item: TraktItem; rating: number; ratedAt: string | null }[]
  favorites: { item: TraktItem; listedAt: string | null }[]
  dropped: { item: TraktItem }[]
  playback: { item: TraktItem; season: number | null; episode: number | null; progress: number; pausedAt: string | null }[]
}

interface TraktStatus {
  connected: boolean
  username: string | null
  connectedAt: string | null
  lastSyncAt: string | null
  lastError?: string | null
  /** The last sync/import result (trakt_sync_state.last_result). */
  lastResult?: { kind: 'import' | 'sync'; at: string; heldBack?: number; drained?: { left: number; notFound: number } } | null
  /** Changes made here, waiting to be sent to Trakt. */
  pending: number
  syncing?: boolean
  notConfigured?: boolean
}

// ── The app's side, reduced to what matching needs ──────────────────────────
interface LocalMovie { tmdbId: number; title: string; year: number | null; status: string; repeatCount: number; rating: number | null; watchedAt?: string | null; watchlistRank?: number | null; note?: string | null }
interface LocalShow { tmdbId: number; title: string; year: number | null; status: string; rating: number | null; watchlistRank?: number | null; note?: string | null }
interface LocalEpisode { tmdbId: number; season: number; episode: number; repeatCount: number; watchedAt?: string | null }
interface LocalLibrary { movies: LocalMovie[]; shows: LocalShow[]; episodes: LocalEpisode[] }

// ── traktDates.ts ──
// Trakt keeps a play logged with "unknown date" as the Unix epoch
// (01.01.1970). Pure and import-free (shared into trakt-api).
//
// Movies store an unknown date as NULL (status 'completed' is what says
// "watched"). Episodes keep the epoch: on user_tv_episodes a row with a
// watched_at IS what "watched" means, and NULL there means "not watched" to
// every reader (progress trigger, tallies, next episode, the AI).

const UNKNOWN_WATCHED_AT = '1970-01-01T00:00:00.000Z'

function isUnknownWatchedAt(iso: string | null | undefined): boolean {
  if (!iso) return false
  const t = Date.parse(iso)
  return Number.isFinite(t) && t < Date.UTC(1971, 0, 1)
}

/** A movie's watched date as stored here: NULL when Trakt doesn't know it. */
function movieWatchedAt(iso: string | null | undefined): string | null {
  return iso && !isUnknownWatchedAt(iso) ? iso : null
}

// ── traktImportPlan.ts ──
// The import itself, as data (docs/trakt/PLAN.md phase 2): what each title
// becomes here, and what goes to Trakt so both sides hold the same record.
// Pure and import-free (scripts/verify-trakt-import-plan.cjs). Running it
// again after a successful import plans no pushes and no episode writes.
//
// The owner's rules:
//   · one title = one row, by TMDB id; Trakt wins wherever both sides know a fact
//   · a fact only the app knows is sent to Trakt, never dropped
//   · watched or watching beats wishlist — here AND on Trakt (a watched title
//     leaves the Trakt watchlist)
//   · plays = 1 + repeat_count
//   · a show with watched episodes is Completed once every aired episode is
//     watched, otherwise Watching (Paused and Dropped are kept)

interface ShowInfo { aired: number }

interface MovieWrite {
  tmdbId: number
  item: TraktItem | null
  status: string
  repeatCount: number
  watchedAt: string | null
  rating: number | null
  watchlistRank: number | null
}
interface ShowWrite {
  tmdbId: number
  item: TraktItem | null
  status: string
  rating: number | null
  watchlistRank: number | null
}
interface EpisodeWrite { tmdbId: number; season: number; episode: number; repeatCount: number; watchedAt: string }

interface PushPlan {
  history: { movies: { tmdb: number; watchedAt: string | null }[]; episodes: { tmdb: number; season: number; episode: number; watchedAt: string | null }[] }
  ratings: { movies: { tmdb: number; rating: number }[]; shows: { tmdb: number; rating: number }[] }
  watchlistAdd: { movies: { tmdb: number }[]; shows: { tmdb: number }[] }
  watchlistRemove: { movies: { tmdb: number }[]; shows: { tmdb: number }[] }
  /** Shows dropped here but not on Trakt → Trakt's hidden "dropped" section. */
  droppedAdd: { shows: { tmdb: number }[] }
}

interface ImportPlan {
  movies: MovieWrite[]
  shows: ShowWrite[]
  episodes: EpisodeWrite[]
  push: PushPlan
  /** Every Trakt item with a TMDB id, for filling the catalogue's trakt/imdb/tvdb ids. */
  ids: TraktItem[]
}

/** One history entry per play, a minute apart, so Trakt counts every play. */
function playEntries<B extends object>(base: B, at: string | null, count: number, fallback: string): (B & { watchedAt: string })[] {
  const start = new Date(at ?? fallback).getTime()
  return Array.from({ length: Math.max(1, count) }, (_, i) =>
    ({ ...base, watchedAt: count > 1 || !at ? new Date(start - i * 60_000).toISOString() : at }))
}

const playsOf = (repeatCount: number) => 1 + Math.max(0, repeatCount || 0)

const KEEP_MOVIE = new Set(['watching', 'dropped', 'upcoming'])
const IN_PROGRESS_SHOW = new Set(['watching', 'completed', 'paused'])

/** Shows whose TMDB details the plan needs to settle Completed vs Watching. */
function showsNeedingInfo(snap: TraktSnapshot, local: LocalLibrary): number[] {
  const ids = new Set<number>()
  for (const w of snap.watchedShows) if (w.item.ids.tmdb && w.episodes.length) ids.add(w.item.ids.tmdb)
  for (const e of local.episodes) ids.add(e.tmdbId)
  return [...ids]
}

function buildImportPlan(snap: TraktSnapshot, local: LocalLibrary, info: Map<number, ShowInfo>): ImportPlan {
  const push: PushPlan = {
    history: { movies: [], episodes: [] },
    ratings: { movies: [], shows: [] },
    watchlistAdd: { movies: [], shows: [] },
    watchlistRemove: { movies: [], shows: [] },
    droppedAdd: { shows: [] },
  }
  const ids = new Map<string, TraktItem>()
  const note = (i: TraktItem) => { if (i.ids.tmdb) ids.set(`${i.type}:${i.ids.tmdb}`, i) }

  const watchlist = new Map<string, { rank: number | null; item: TraktItem }>()
  for (const w of snap.watchlist) if (w.item.ids.tmdb) { watchlist.set(`${w.item.type}:${w.item.ids.tmdb}`, { rank: w.rank, item: w.item }); note(w.item) }
  const ratings = new Map<string, { rating: number; item: TraktItem }>()
  for (const r of snap.ratings) if (r.item.ids.tmdb) { ratings.set(`${r.item.type}:${r.item.ids.tmdb}`, { rating: r.rating, item: r.item }); note(r.item) }
  const dropped = new Set<number>()
  for (const d of snap.dropped) if (d.item.ids.tmdb) { dropped.add(d.item.ids.tmdb); note(d.item) }

  // ── Movies ─────────────────────────────────────────────────────────────────
  const tWatched = new Map<number, TraktSnapshot['watchedMovies'][number]>()
  for (const w of snap.watchedMovies) if (w.item.ids.tmdb) { tWatched.set(w.item.ids.tmdb, w); note(w.item) }
  const lMovies = new Map(local.movies.map(m => [m.tmdbId, m]))
  const movieKeys = new Set<number>([...tWatched.keys(), ...lMovies.keys()])
  for (const [k, w] of watchlist) if (w.item.type === 'movie') movieKeys.add(Number(k.split(':')[1]))

  const movies: MovieWrite[] = []
  for (const id of movieKeys) {
    const t = tWatched.get(id)
    const l = lMovies.get(id)
    const wl = watchlist.get(`movie:${id}`)
    const r = ratings.get(`movie:${id}`)
    const watched = !!t || l?.status === 'completed'
    let status: string
    if (watched) status = 'completed'
    else if (l && KEEP_MOVIE.has(l.status)) status = l.status
    else if (wl || l?.status === 'wishlist') status = 'wishlist'
    else if (l) status = l.status
    else continue
    const playCount = t ? t.plays : l ? playsOf(l.repeatCount) : 0
    const rating = r?.rating ?? l?.rating ?? null
    movies.push({
      tmdbId: id, item: t?.item ?? wl?.item ?? r?.item ?? null, status,
      repeatCount: watched ? Math.max(0, playCount - 1) : 0,
      watchedAt: t ? movieWatchedAt(t.lastWatchedAt) : movieWatchedAt(l?.watchedAt),
      rating, watchlistRank: status === 'wishlist' ? wl?.rank ?? null : null,
    })
    if (l?.status === 'completed' && !t) push.history.movies.push(...playEntries({ tmdb: id }, l.watchedAt ?? null, playsOf(l.repeatCount), snap.fetchedAt))
    if (l?.rating != null && !r) push.ratings.movies.push({ tmdb: id, rating: l.rating })
    if (status === 'wishlist' && !wl) push.watchlistAdd.movies.push({ tmdb: id })
    if (wl && status !== 'wishlist') push.watchlistRemove.movies.push({ tmdb: id })
  }

  // ── Shows + episodes ───────────────────────────────────────────────────────
  const tShows = new Map<number, TraktSnapshot['watchedShows'][number]>()
  for (const w of snap.watchedShows) if (w.item.ids.tmdb) { tShows.set(w.item.ids.tmdb, w); note(w.item) }
  const lShows = new Map(local.shows.map(s => [s.tmdbId, s]))
  const lEps = new Map<number, Map<string, { repeatCount: number; watchedAt: string | null }>>()
  for (const e of local.episodes) {
    const m = lEps.get(e.tmdbId) ?? new Map()
    m.set(`${e.season}x${e.episode}`, { repeatCount: e.repeatCount, watchedAt: e.watchedAt ?? null })
    lEps.set(e.tmdbId, m)
  }
  const showKeys = new Set<number>([...tShows.keys(), ...lShows.keys(), ...lEps.keys(), ...dropped])
  for (const [k, w] of watchlist) if (w.item.type === 'show') showKeys.add(Number(k.split(':')[1]))

  const shows: ShowWrite[] = []
  const episodes: EpisodeWrite[] = []
  for (const id of showKeys) {
    const t = tShows.get(id)
    const l = lShows.get(id)
    const mine = lEps.get(id) ?? new Map()
    const wl = watchlist.get(`show:${id}`)
    const r = ratings.get(`show:${id}`)

    const union = new Set<string>(mine.keys())
    for (const [season, episode, plays, at] of t?.episodes ?? []) {
      const key = `${season}x${episode}`
      union.add(key)
      const have = mine.get(key)
      if (!have || 1 + have.repeatCount !== plays) {
        episodes.push({ tmdbId: id, season, episode, repeatCount: Math.max(0, plays - 1), watchedAt: at ?? t?.lastWatchedAt ?? snap.fetchedAt })
      }
    }
    const theirs = new Set((t?.episodes ?? []).map(([s, e]) => `${s}x${e}`))
    for (const [key, v] of mine) {
      if (theirs.has(key)) continue
      const [season, episode] = key.split('x').map(Number)
      push.history.episodes.push(...playEntries({ tmdb: id, season, episode }, v.watchedAt, playsOf(v.repeatCount), snap.fetchedAt))
    }

    const isDropped = dropped.has(id) || l?.status === 'dropped'
    if (l?.status === 'dropped' && !dropped.has(id)) push.droppedAdd.shows.push({ tmdb: id })
    const regular = [...union].filter(k => !k.startsWith('0x')).length
    const aired = info.get(id)?.aired
    let status: string
    if (union.size) {
      // Without TMDB's aired count nothing is known about "finished": keep the
      // status the show has (a Completed show must never drop to Watching).
      status = isDropped ? 'dropped'
        : aired === undefined ? (l && IN_PROGRESS_SHOW.has(l.status) ? l.status : 'watching')
        : aired > 0 && regular >= aired ? 'completed'
        : l?.status === 'paused' ? 'paused' : 'watching'
    } else if (isDropped) status = 'dropped'
    else if (l && IN_PROGRESS_SHOW.has(l.status)) status = l.status
    else if (wl || l?.status === 'wishlist') status = 'wishlist'
    else if (l) status = l.status
    else continue

    shows.push({
      tmdbId: id, item: t?.item ?? wl?.item ?? r?.item ?? null, status,
      rating: r?.rating ?? l?.rating ?? null,
      watchlistRank: status === 'wishlist' ? wl?.rank ?? null : null,
    })
    if (l?.rating != null && !r) push.ratings.shows.push({ tmdb: id, rating: l.rating })
    if (status === 'wishlist' && !wl) push.watchlistAdd.shows.push({ tmdb: id })
    if (wl && status !== 'wishlist') push.watchlistRemove.shows.push({ tmdb: id })
  }

  return { movies, shows, episodes, push, ids: [...ids.values()] }
}

/** Aired regular episodes from TMDB's show details (specials excluded). */
function airedEpisodes(details: {
  seasons?: { season_number: number; episode_count: number }[]
  last_episode_to_air?: { season_number: number; episode_number: number } | null
}): number {
  const last = details.last_episode_to_air
  if (!last) return 0
  let n = 0
  for (const s of details.seasons ?? []) {
    if (s.season_number <= 0) continue
    if (s.season_number < last.season_number) n += s.episode_count
    else if (s.season_number === last.season_number) n += last.episode_number
  }
  return n
}

function pushCount(p: PushPlan): number {
  return p.history.movies.length + p.history.episodes.length + p.ratings.movies.length + p.ratings.shows.length
    + p.watchlistAdd.movies.length + p.watchlistAdd.shows.length + p.watchlistRemove.movies.length + p.watchlistRemove.shows.length
    + p.droppedAdd.shows.length
}

// ── traktSyncPlan.ts ──
// The automatic sync, as data (docs/trakt/PLAN.md phase 3): Trakt → app.
// Pure and import-free (scripts/verify-trakt-sync-plan.cjs), shared into the
// trakt-api edge function by scripts/sync-trakt-shared.mjs.
//
// It runs AFTER the outbox has sent the app's own changes, so at this point
// Trakt holds everything the app did and is simply mirrored: a fact Trakt
// lost was removed on Trakt, and goes here too. Items with an outbox row
// still waiting (a failed send) are left alone until it goes through.
//
// App-only facts are never touched: a Paused show, a Watching/Dropped movie,
// a show marked Watching or Completed without episode rows, priority, plans.
// An entry is only ever deleted when every fact it holds belongs to Trakt and
// Trakt no longer has any of them — and never while it carries a note.

interface EpisodeRef { tmdbId: number; season: number; episode: number }

interface SyncPlan {
  /** Entries to create or change (only those that differ). */
  movies: MovieWrite[]
  shows: ShowWrite[]
  episodes: EpisodeWrite[]
  movieDeletes: number[]
  showDeletes: number[]
  episodeDeletes: EpisodeRef[]
  /** New catalogue titles (not yet in the library), for their trakt/imdb/tvdb ids. */
  ids: TraktItem[]
  /** Keys left alone: an unsent change is waiting, or a note keeps the entry. */
  kept: string[]
}

const itemKey = {
  movie: (tmdb: number) => `movie:${tmdb}`,
  show: (tmdb: number) => `show:${tmdb}`,
  episode: (tmdb: number, season: number, episode: number) => `ep:${tmdb}:${season}:${episode}`,
}

const sameTime = (a: string | null | undefined, b: string | null | undefined) =>
  (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null)

/** Shows whose episode set changes, so their Completed/Watching needs TMDB's aired count. */
function showsNeedingInfoForSync(snap: TraktSnapshot, local: LocalLibrary, pending: Set<string>): number[] {
  const mine = new Map<number, Set<string>>()
  for (const e of local.episodes) {
    const s = mine.get(e.tmdbId) ?? new Set<string>()
    s.add(`${e.season}x${e.episode}`)
    mine.set(e.tmdbId, s)
  }
  const out = new Set<number>()
  const seen = new Set<number>()
  for (const w of snap.watchedShows) {
    const id = w.item.ids.tmdb
    if (!id) continue
    seen.add(id)
    const have = mine.get(id) ?? new Set<string>()
    const theirs = new Set(w.episodes.map(([s, e]) => `${s}x${e}`))
    const changed = theirs.size !== have.size || [...theirs].some(k => !have.has(k))
    if (changed && theirs.size) out.add(id)
  }
  // Every episode removed on Trakt but some kept by a pending change.
  for (const [id, keys] of mine) {
    if (seen.has(id)) continue
    if ([...keys].some(k => { const [s, e] = k.split('x').map(Number); return pending.has(itemKey.episode(id, s, e)) })) out.add(id)
  }
  return [...out]
}

function buildSyncPlan(snap: TraktSnapshot, local: LocalLibrary, info: Map<number, ShowInfo>, pending: Set<string>): SyncPlan {
  const plan: SyncPlan = { movies: [], shows: [], episodes: [], movieDeletes: [], showDeletes: [], episodeDeletes: [], ids: [], kept: [] }
  const newIds = new Map<string, TraktItem>()
  const noteNew = (i: TraktItem | null | undefined) => { if (i?.ids.tmdb) newIds.set(`${i.type}:${i.ids.tmdb}`, i) }

  const watchlist = new Map<string, { rank: number | null; item: TraktItem }>()
  for (const w of snap.watchlist) if (w.item.ids.tmdb) watchlist.set(`${w.item.type}:${w.item.ids.tmdb}`, { rank: w.rank, item: w.item })
  const ratings = new Map<string, { rating: number; item: TraktItem }>()
  for (const r of snap.ratings) if (r.item.ids.tmdb) ratings.set(`${r.item.type}:${r.item.ids.tmdb}`, { rating: r.rating, item: r.item })
  const dropped = new Map<number, TraktItem>()
  for (const d of snap.dropped) if (d.item.ids.tmdb) dropped.set(d.item.ids.tmdb, d.item)

  // ── Movies ─────────────────────────────────────────────────────────────────
  const tWatched = new Map<number, TraktSnapshot['watchedMovies'][number]>()
  for (const w of snap.watchedMovies) if (w.item.ids.tmdb) tWatched.set(w.item.ids.tmdb, w)
  const lMovies = new Map(local.movies.map(m => [m.tmdbId, m]))
  const movieKeys = new Set<number>([...tWatched.keys(), ...lMovies.keys()])
  for (const [k, w] of watchlist) if (w.item.type === 'movie') movieKeys.add(Number(k.split(':')[1]))

  for (const id of movieKeys) {
    const key = itemKey.movie(id)
    if (pending.has(key)) { plan.kept.push(key); continue }
    const t = tWatched.get(id)
    const l = lMovies.get(id)
    const wl = watchlist.get(`movie:${id}`)
    const rating = ratings.get(`movie:${id}`)?.rating ?? null

    let w: MovieWrite
    if (t) {
      // Watching (a rewatch) and Dropped are app-only and stay; the plays follow Trakt.
      const status = l && (l.status === 'watching' || l.status === 'dropped') ? l.status : 'completed'
      w = { tmdbId: id, item: t.item, status, repeatCount: Math.max(0, t.plays - 1), watchedAt: movieWatchedAt(t.lastWatchedAt), rating, watchlistRank: null }
    } else if (l && (l.status === 'watching' || l.status === 'dropped')) {
      // App-only states: only the rating follows Trakt.
      w = { tmdbId: id, item: null, status: l.status, repeatCount: l.repeatCount, watchedAt: l.watchedAt ?? null, rating, watchlistRank: null }
    } else if (wl) {
      w = { tmdbId: id, item: wl.item, status: l?.status === 'upcoming' ? 'upcoming' : 'wishlist', repeatCount: 0, watchedAt: null, rating, watchlistRank: wl.rank }
    } else if (l) {
      // Completed or wishlisted here, and Trakt holds none of it any more.
      if (l.note) plan.kept.push(key)
      else plan.movieDeletes.push(id)
      continue
    } else continue

    if (!l) { plan.movies.push(w); noteNew(w.item); continue }
    const differs = w.status !== l.status || w.rating !== (l.rating ?? null)
      || (!!t && (w.repeatCount !== l.repeatCount || !sameTime(w.watchedAt, l.watchedAt)))
      || (l.watchlistRank !== undefined && w.watchlistRank !== (l.watchlistRank ?? null))
    if (differs) {
      // Leaving Completed clears the play record along with it.
      if (!t && l.status === 'completed') { w.repeatCount = 0; w.watchedAt = null }
      plan.movies.push(w)
    }
  }

  // ── Shows + episodes ───────────────────────────────────────────────────────
  const tShows = new Map<number, TraktSnapshot['watchedShows'][number]>()
  for (const w of snap.watchedShows) if (w.item.ids.tmdb) tShows.set(w.item.ids.tmdb, w)
  const lShows = new Map(local.shows.map(s => [s.tmdbId, s]))
  const lEps = new Map<number, Map<string, number>>()
  for (const e of local.episodes) {
    const m = lEps.get(e.tmdbId) ?? new Map<string, number>()
    m.set(`${e.season}x${e.episode}`, e.repeatCount)
    lEps.set(e.tmdbId, m)
  }
  const showKeys = new Set<number>([...tShows.keys(), ...lShows.keys(), ...lEps.keys(), ...dropped.keys()])
  for (const [k, w] of watchlist) if (w.item.type === 'show') showKeys.add(Number(k.split(':')[1]))

  for (const id of showKeys) {
    const t = tShows.get(id)
    const l = lShows.get(id)
    const mine = lEps.get(id) ?? new Map<string, number>()
    const wl = watchlist.get(`show:${id}`)
    const rating = ratings.get(`show:${id}`)?.rating ?? null
    const showKey = itemKey.show(id)
    const showPending = pending.has(showKey)

    // Episodes: Trakt's set, except those with a change still waiting to go out.
    const finalEps = new Set<string>()
    const epWrites: EpisodeWrite[] = []
    const theirs = new Set<string>()
    for (const [season, episode, plays, at] of t?.episodes ?? []) {
      const k = `${season}x${episode}`
      theirs.add(k)
      const ek = itemKey.episode(id, season, episode)
      if (pending.has(ek)) { plan.kept.push(ek); if (mine.has(k)) finalEps.add(k); continue }
      finalEps.add(k)
      const have = mine.get(k)
      if (have === undefined || have !== Math.max(0, plays - 1)) {
        epWrites.push({ tmdbId: id, season, episode, repeatCount: Math.max(0, plays - 1), watchedAt: at ?? t?.lastWatchedAt ?? snap.fetchedAt })
      }
    }
    for (const k of mine.keys()) {
      if (theirs.has(k)) continue
      const [season, episode] = k.split('x').map(Number)
      const ek = itemKey.episode(id, season, episode)
      if (pending.has(ek)) { plan.kept.push(ek); finalEps.add(k); continue }
      plan.episodeDeletes.push({ tmdbId: id, season, episode })
    }

    if (showPending) {
      plan.kept.push(showKey)
      // Episodes need an entry to hang on; a pending show without one waits.
      if (l) plan.episodes.push(...epWrites)
      continue
    }

    const isDropped = dropped.has(id)
    const regular = [...finalEps].filter(k => !k.startsWith('0x')).length
    let status: string | null
    if (finalEps.size) {
      const aired = info.get(id)?.aired
      if (isDropped) status = 'dropped'
      else if (aired !== undefined) status = aired > 0 && regular >= aired ? 'completed' : l?.status === 'paused' ? 'paused' : 'watching'
      else status = l && IN_PROGRESS_SHOW.has(l.status) ? l.status : 'watching'
    } else if (isDropped) status = 'dropped'
    else if (l && IN_PROGRESS_SHOW.has(l.status)) status = l.status
    else if (wl) status = 'wishlist'
    else if (l) status = null
    else continue

    if (status === null) {
      // Wishlisted or dropped here, and Trakt holds none of it any more.
      if (l!.note) plan.kept.push(showKey)
      else plan.showDeletes.push(id)
      continue
    }

    const w: ShowWrite = {
      tmdbId: id, item: t?.item ?? wl?.item ?? dropped.get(id) ?? null, status, rating,
      watchlistRank: status === 'wishlist' ? wl?.rank ?? null : null,
    }
    if (!l) { plan.shows.push(w); noteNew(w.item) }
    else if (w.status !== l.status || w.rating !== (l.rating ?? null)
      || (l.watchlistRank !== undefined && w.watchlistRank !== (l.watchlistRank ?? null))) plan.shows.push(w)
    plan.episodes.push(...epWrites)
  }

  plan.ids = [...newIds.values()]
  return plan
}

const removalCount = (p: SyncPlan) => p.movieDeletes.length + p.showDeletes.length + p.episodeDeletes.length

/**
 * A sync never removes a big part of the library by itself: more than
 * max(10, 10 %) of it at once is held back until the owner confirms (a Trakt
 * outage returning an empty list must not empty the library).
 */
function removalsNeedConfirm(p: SyncPlan, local: LocalLibrary): boolean {
  const size = local.movies.length + local.shows.length + local.episodes.length
  return removalCount(p) > Math.max(10, Math.floor(size * 0.1))
}

function withoutRemovals(p: SyncPlan): SyncPlan {
  return { ...p, movieDeletes: [], showDeletes: [], episodeDeletes: [] }
}

// </trakt-shared>

// ── Library side (service role, one user, writes marked x-trakt-sync) ───────
// deno-lint-ignore no-explicit-any
type Db = any

const TMDB = 'https://api.themoviedb.org/3'
const TMDB_KEY = () => Deno.env.get('TMDB_API_KEY') ?? ''

/** TMDB refused the key itself — every lookup would fail, so the run stops instead of guessing. */
class TmdbKeyError extends Error {
  constructor() { super('TMDB rejected TMDB_API_KEY on the trakt-api function (401) — put a valid TMDB v3 API key there') }
}

async function tmdb(path: string): Promise<AnyRec> {
  const res = await fetch(`${TMDB}${path}?api_key=${encodeURIComponent(TMDB_KEY())}&language=en-US`)
  if (res.status === 401) throw new TmdbKeyError()
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`)
  return await res.json()
}

/** Runs `fn` over `items`, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

/** Every row of a query, past PostgREST's 1,000-row page. */
async function allRows(build: () => AnyRec): Promise<AnyRec[]> {
  const out: AnyRec[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await (build() as { range: (a: number, b: number) => Promise<{ data: AnyRec[] | null; error: unknown }> }).range(from, from + 999)
    if (error) throw error
    out.push(...(data ?? []))
    if (!data || data.length < 1000) return out
  }
}

const one = (v: unknown): AnyRec | null => (Array.isArray(v) ? (v[0] as AnyRec) ?? null : (v as AnyRec) ?? null)
const yearOf = (d: unknown) => (typeof d === 'string' && d ? Number(d.slice(0, 4)) || null : null)

interface Local {
  lib: LocalLibrary
  movieEntry: Map<number, { movieId: string }>
  showEntry: Map<number, { entryId: string; seriesId: string }>
}

async function loadLocal(db: Db, userId: string): Promise<Local> {
  const [mv, tv, eps] = await Promise.all([
    allRows(() => db.from('user_movie_entries').select('id, movie_id, status, repeat_count, rating, watched_at, watchlist_rank, personal_note, movie:movies(tmdb_id, title, release_date)').eq('user_id', userId).order('id')),
    allRows(() => db.from('user_tv_entries').select('id, tv_series_id, status, rating, watchlist_rank, personal_note, tv_series:tv_series(tmdb_id, title, first_air_date)').eq('user_id', userId).order('id')),
    allRows(() => db.from('user_tv_episodes').select('season_number, episode_number, repeat_count, watched_at, tv_series:tv_series(tmdb_id)').eq('user_id', userId).not('watched_at', 'is', null).order('id')),
  ])
  const movieEntry = new Map<number, { movieId: string }>()
  const showEntry = new Map<number, { entryId: string; seriesId: string }>()
  const lib: LocalLibrary = { movies: [], shows: [], episodes: [] }
  for (const r of mv) {
    const m = one(r.movie); const tmdbId = Number(m?.tmdb_id)
    if (!tmdbId) continue
    movieEntry.set(tmdbId, { movieId: String(r.movie_id) })
    lib.movies.push({ tmdbId, title: String(m?.title ?? ''), year: yearOf(m?.release_date), status: String(r.status), repeatCount: Number(r.repeat_count) || 0,
      rating: (r.rating as number) ?? null, watchedAt: (r.watched_at as string) ?? null, watchlistRank: (r.watchlist_rank as number) ?? null, note: (r.personal_note as string) || null })
  }
  for (const r of tv) {
    const t = one(r.tv_series); const tmdbId = Number(t?.tmdb_id)
    if (!tmdbId) continue
    showEntry.set(tmdbId, { entryId: String(r.id), seriesId: String(r.tv_series_id) })
    lib.shows.push({ tmdbId, title: String(t?.title ?? ''), year: yearOf(t?.first_air_date), status: String(r.status),
      rating: (r.rating as number) ?? null, watchlistRank: (r.watchlist_rank as number) ?? null, note: (r.personal_note as string) || null })
  }
  for (const r of eps) {
    const tmdbId = Number(one(r.tv_series)?.tmdb_id)
    if (tmdbId) lib.episodes.push({ tmdbId, season: Number(r.season_number), episode: Number(r.episode_number), repeatCount: Number(r.repeat_count) || 0, watchedAt: (r.watched_at as string) ?? null })
  }
  return { lib, movieEntry, showEntry }
}

/** TMDB show details for Completed vs Watching (and for creating new show rows). */
async function showInfo(ids: number[]): Promise<{ info: Map<number, ShowInfo>; details: Map<number, AnyRec> }> {
  const info = new Map<number, ShowInfo>()
  const details = new Map<number, AnyRec>()
  if (!TMDB_KEY()) return { info, details }
  await pool(ids, 5, async id => {
    try {
      const d = await tmdb(`/tv/${id}`)
      details.set(id, d)
      info.set(id, { aired: airedEpisodes(d as Parameters<typeof airedEpisodes>[0]) })
    } catch (e) {
      if (e instanceof TmdbKeyError) throw e
      /* no TMDB details for this one show: its status is left as it is, never guessed */
    }
  })
  return { info, details }
}

function movieRow(d: AnyRec) {
  return {
    tmdb_id: d.id, title: d.title, original_title: d.original_title, overview: d.overview, release_date: d.release_date || null,
    runtime: d.runtime, status: d.status, poster_path: d.poster_path, backdrop_path: d.backdrop_path, genres: d.genres,
    tmdb_rating: d.vote_average, tmdb_vote_count: d.vote_count, metadata_json: d,
  }
}
function showRow(d: AnyRec) {
  return {
    tmdb_id: d.id, title: d.name, original_title: d.original_name, overview: d.overview, first_air_date: d.first_air_date || null,
    last_air_date: d.last_air_date || null, status: d.status, episode_run_time: ((d.episode_run_time as number[]) ?? [])[0] ?? null,
    number_of_seasons: d.number_of_seasons, number_of_episodes: d.number_of_episodes, poster_path: d.poster_path,
    backdrop_path: d.backdrop_path, genres: d.genres, tmdb_rating: d.vote_average, tmdb_vote_count: d.vote_count, metadata_json: d,
  }
}

/** tmdb_id → catalogue row id, creating rows the library doesn't have yet from TMDB. */
async function catalogIds(db: Db, table: 'movies' | 'tv_series', ids: number[], details: Map<number, AnyRec>): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  for (const part of chunk(ids, 200)) {
    const { data, error } = await db.from(table).select('id, tmdb_id').in('tmdb_id', part)
    if (error) throw error
    for (const r of data ?? []) map.set(Number(r.tmdb_id), String(r.id))
  }
  const missing = ids.filter(id => !map.has(id))
  if (missing.length && !TMDB_KEY()) return map
  await pool(missing, 4, async id => {
    try {
      const d = details.get(id) ?? await tmdb(`/${table === 'movies' ? 'movie' : 'tv'}/${id}`)
      const { data, error } = await db.from(table).upsert(table === 'movies' ? movieRow(d) : showRow(d), { onConflict: 'tmdb_id' }).select('id').single()
      if (error) throw error
      map.set(id, String(data.id))
    } catch (e) {
      if (e instanceof TmdbKeyError) throw e
      /* counted as skipped by the caller */
    }
  })
  return map
}

interface Writes {
  movies: MovieWrite[]; shows: ShowWrite[]; episodes: EpisodeWrite[]
  movieDeletes?: number[]; showDeletes?: number[]; episodeDeletes?: EpisodeRef[]
}

async function applyWrites(db: Db, userId: string, local: Local, w: Writes, details: Map<number, AnyRec>) {
  const now = new Date().toISOString()
  const done = { movies: 0, shows: 0, episodes: 0, removed: 0, skippedNew: 0 }

  const movieIds = new Map([...local.movieEntry].map(([k, v]) => [k, v.movieId]))
  const newMovies = w.movies.map(m => m.tmdbId).filter(id => !movieIds.has(id))
  for (const [k, v] of await catalogIds(db, 'movies', newMovies, new Map())) movieIds.set(k, v)
  const mRows = w.movies.flatMap(m => {
    const movieId = movieIds.get(m.tmdbId)
    if (!movieId) { done.skippedNew++; return [] }
    return [{ user_id: userId, movie_id: movieId, status: m.status, repeat_count: m.repeatCount, watched_at: m.watchedAt,
      rating: m.rating, watchlist_rank: m.watchlistRank, trakt_synced_at: now }]
  })
  for (const part of chunk(mRows, 500)) {
    const { error } = await db.from('user_movie_entries').upsert(part, { onConflict: 'user_id,movie_id' })
    if (error) throw error
    done.movies += part.length
  }

  const seriesIds = new Map([...local.showEntry].map(([k, v]) => [k, v.seriesId]))
  const entryBySeries = new Map([...local.showEntry.values()].map(v => [v.seriesId, v.entryId]))
  const newShows = w.shows.map(s => s.tmdbId).filter(id => !seriesIds.has(id))
  for (const [k, v] of await catalogIds(db, 'tv_series', newShows, details)) seriesIds.set(k, v)
  const sRows = w.shows.flatMap(s => {
    const seriesId = seriesIds.get(s.tmdbId)
    if (!seriesId) { done.skippedNew++; return [] }
    return [{ user_id: userId, tv_series_id: seriesId, status: s.status, rating: s.rating, watchlist_rank: s.watchlistRank, trakt_synced_at: now }]
  })
  for (const part of chunk(sRows, 500)) {
    const { data, error } = await db.from('user_tv_entries').upsert(part, { onConflict: 'user_id,tv_series_id' }).select('id, tv_series_id')
    if (error) throw error
    for (const r of data ?? []) entryBySeries.set(String(r.tv_series_id), String(r.id))
    done.shows += part.length
  }

  const eRows = w.episodes.flatMap(e => {
    const seriesId = seriesIds.get(e.tmdbId)
    const entryId = seriesId && entryBySeries.get(seriesId)
    return seriesId && entryId ? [{ user_id: userId, tv_entry_id: entryId, tv_series_id: seriesId, season_number: e.season,
      episode_number: e.episode, watched_at: e.watchedAt, repeat_count: e.repeatCount }] : []
  })
  for (const part of chunk(eRows, 500)) {
    const { error } = await db.from('user_tv_episodes').upsert(part, { onConflict: 'user_id,tv_series_id,season_number,episode_number' })
    if (error) throw error
    done.episodes += part.length
  }

  const movieDel = (w.movieDeletes ?? []).map(id => movieIds.get(id)).filter(Boolean) as string[]
  for (const part of chunk(movieDel, 200)) {
    const { error } = await db.from('user_movie_entries').delete().eq('user_id', userId).in('movie_id', part)
    if (error) throw error
    done.removed += part.length
  }
  const showDel = (w.showDeletes ?? []).map(id => seriesIds.get(id)).filter(Boolean) as string[]
  for (const part of chunk(showDel, 200)) {
    const { error } = await db.from('user_tv_entries').delete().eq('user_id', userId).in('tv_series_id', part)
    if (error) throw error
    done.removed += part.length
  }
  const bySeries = new Map<string, EpisodeRef[]>()
  for (const e of w.episodeDeletes ?? []) {
    const sid = seriesIds.get(e.tmdbId)
    if (sid) bySeries.set(sid, [...(bySeries.get(sid) ?? []), e])
  }
  for (const [sid, refs] of bySeries) {
    for (const part of chunk(refs, 50)) {
      const { error } = await db.from('user_tv_episodes').delete().eq('user_id', userId).eq('tv_series_id', sid)
        .or(part.map(r => `and(season_number.eq.${r.season},episode_number.eq.${r.episode})`).join(','))
      if (error) throw error
      done.removed += part.length
    }
  }
  return done
}

/** Fills trakt/imdb/tvdb ids on catalogue rows; a clash with another row is skipped, never forced. */
async function backfillIds(db: Db, items: TraktItem[]) {
  await pool(items, 5, async i => {
    const patch: AnyRec = { trakt_id: i.ids.trakt || null, trakt_slug: i.ids.slug, imdb_id: i.ids.imdb }
    if (i.type === 'show') patch.tvdb_id = i.ids.tvdb
    const { error } = await db.from(i.type === 'movie' ? 'movies' : 'tv_series').update(patch).eq('tmdb_id', i.ids.tmdb)
    if (error && error.code !== '23505') throw error
  })
}

// ── The outbox: app → Trakt ──────────────────────────────────────────────────
const OUTBOX_PATHS: Record<string, string> = {
  history_add: '/sync/history', history_remove: '/sync/history/remove',
  rating_add: '/sync/ratings', rating_remove: '/sync/ratings/remove',
  watchlist_add: '/sync/watchlist', watchlist_remove: '/sync/watchlist/remove',
  dropped_add: '/users/hidden/dropped', dropped_remove: '/users/hidden/dropped/remove',
}

/** One Trakt request body for a run of same-op outbox rows. */
function outboxBody(op: string, rows: AnyRec[]): AnyRec {
  const movies: AnyRec[] = []
  const shows: AnyRec[] = []
  const eps = new Map<number, Map<number, AnyRec[]>>()
  for (const r of rows) {
    const p = (r.payload ?? {}) as AnyRec
    const extra: AnyRec = {}
    if (op === 'history_add' && p.watched_at) extra.watched_at = p.watched_at
    if (op === 'rating_add') extra.rating = p.rating
    if (p.type === 'movie') movies.push({ ids: { tmdb: p.tmdb }, ...extra })
    else if (p.type === 'show') shows.push({ ids: { tmdb: p.tmdb }, ...extra })
    else if (p.type === 'episode') {
      const seasons = eps.get(Number(p.tmdb)) ?? new Map<number, AnyRec[]>()
      seasons.set(Number(p.season), [...(seasons.get(Number(p.season)) ?? []), { number: p.episode, ...extra }])
      eps.set(Number(p.tmdb), seasons)
    }
  }
  for (const [tmdbId, seasons] of eps) {
    shows.push({ ids: { tmdb: tmdbId }, seasons: [...seasons].map(([number, episodes]) => ({ number, episodes })) })
  }
  return op.startsWith('dropped') ? { shows } : { movies, shows }
}

const notFoundCount = (res: AnyRec) => Object.values((res.not_found ?? {}) as AnyRec)
  .reduce((n: number, v) => n + (Array.isArray(v) ? v.length : 0), 0)

async function drainOutbox(db: Db, userId: string, token: string, deadline: number) {
  const out = { sent: 0, notFound: 0, failed: 0, left: 0, error: null as string | null }
  const sentKeys: string[] = []
  const { data, error } = await db.from('trakt_outbox').select('id, op, item_key, payload, attempts')
    .eq('user_id', userId).lte('next_retry_at', new Date().toISOString())
    .order('created_at').order('id').limit(500)
  if (error) throw error
  const rows = (data ?? []) as AnyRec[]
  let i = 0
  let calls = 0
  while (i < rows.length && calls < 40 && Date.now() < deadline) {
    const op = String(rows[i].op)
    let j = i + 1
    while (j < rows.length && rows[j].op === op && j - i < 100) j++
    const batch = rows.slice(i, j)
    const ids = batch.map(r => r.id)
    const path = OUTBOX_PATHS[op]
    try {
      if (path) {
        const res = await post(path, token, outboxBody(op, batch))
        out.notFound += notFoundCount(res)
        calls++
      }
      const { error: delError } = await db.from('trakt_outbox').delete().in('id', ids)
      if (delError) throw delError
      out.sent += batch.length
      sentKeys.push(...batch.map(r => String(r.item_key)))
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (e instanceof TraktError && e.status === 401) throw e
      const attempts = Number(batch[0].attempts ?? 0) + 1
      await db.from('trakt_outbox').update({
        attempts, last_error: message,
        next_retry_at: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000).toISOString(),
      }).in('id', ids)
      out.failed += batch.length
      out.error = message
      break // keep the order: nothing after a failed change goes first
    }
    i = j
  }
  const { count } = await db.from('trakt_outbox').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  out.left = count ?? 0
  return { ...out, sentKeys }
}

// ── Lock + stamps ────────────────────────────────────────────────────────────
const missingColumn = (e: unknown) => ['42703', 'PGRST204'].includes(String((e as AnyRec)?.code ?? ''))

/** One sync at a time per user (the cron and a Sync tap can meet); a lock older than 5 min is stale. */
async function takeLock(db: Db, userId: string): Promise<boolean> {
  await db.from('trakt_sync_state').upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true })
  const stale = new Date(Date.now() - 5 * 60_000).toISOString()
  const { data, error } = await db.from('trakt_sync_state').update({ sync_started_at: new Date().toISOString() })
    .eq('user_id', userId).or(`sync_started_at.is.null,sync_started_at.lt.${stale}`).select('user_id')
  if (error && missingColumn(error)) return true // before migration 117
  if (error) throw error
  return (data ?? []).length > 0
}

async function stamp(db: Db, userId: string, fields: AnyRec) {
  const row: AnyRec = { user_id: userId, updated_at: new Date().toISOString(), sync_started_at: null, ...fields }
  const { error } = await db.from('trakt_sync_state').upsert(row)
  if (error && missingColumn(error)) {
    const { sync_started_at: _s, last_result: _r, ...rest } = row
    const retry = await db.from('trakt_sync_state').upsert(rest)
    if (retry.error) throw retry.error
  } else if (error) throw error
}

// ── The two runs ─────────────────────────────────────────────────────────────
const summary = ({ sentKeys: _k, ...rest }: Awaited<ReturnType<typeof drainOutbox>>) => rest

async function runSync(db: Db, userId: string, token: string, username: string | null, opts: { full?: boolean; force?: boolean }) {
  const deadline = Date.now() + 90_000
  const drained = await drainOutbox(db, userId, token, deadline)
  const lastActivities = (await get('/sync/last_activities', token)).data as AnyRec
  const { data: state } = await db.from('trakt_sync_state').select('last_activities').eq('user_id', userId).maybeSingle()
  const before = ((state as AnyRec | null)?.last_activities as AnyRec | null)?.all
  if (!opts.full && before && lastActivities?.all && before === lastActivities.all) {
    return { pulled: false, drained: summary(drained), lastActivities }
  }

  const snap = await snapshot(token, username) as unknown as TraktSnapshot
  const local = await loadLocal(db, userId)
  const { data: waiting, error } = await db.from('trakt_outbox').select('item_key').eq('user_id', userId)
  if (error) throw error
  // Items just sent count as pending for this run too: Trakt may not show a
  // write in the same second, and the mirror must never undo it.
  const pending = new Set<string>([...((waiting ?? []) as AnyRec[]).map(r => String(r.item_key)), ...drained.sentKeys])
  // A full sync (Sync now) re-checks Completed vs Watching for every show with
  // episodes; the timed one only for shows whose episodes changed.
  const needInfo = opts.full ? showsNeedingInfo(snap, local.lib) : showsNeedingInfoForSync(snap, local.lib, pending)
  const { info, details } = await showInfo(needInfo)
  let plan = buildSyncPlan(snap, local.lib, info, pending)
  let heldBack = 0
  if (!opts.force && removalsNeedConfirm(plan, local.lib)) { heldBack = removalCount(plan); plan = withoutRemovals(plan) }
  const applied = await applyWrites(db, userId, local, plan, details)
  await backfillIds(db, plan.ids)
  return { pulled: true, drained: summary(drained), applied, heldBack, kept: plan.kept.length, lastActivities }
}

async function runImport(db: Db, userId: string, token: string, username: string | null) {
  // Without TMDB the import can't add new titles or tell a finished show from one in progress.
  if (!TMDB_KEY()) throw new Error('TMDB_API_KEY is not set on the trakt-api function (use the same TMDB key as the app)')
  const snap = await snapshot(token, username) as unknown as TraktSnapshot
  const local = await loadLocal(db, userId)
  const { info, details } = await showInfo(showsNeedingInfo(snap, local.lib))
  const plan = buildImportPlan(snap, local.lib, info)
  const applied = await applyWrites(db, userId, local, plan, details)
  await backfillIds(db, plan.ids)
  const sent = pushCount(plan.push)
  const tally = await push(token, plan.push)
  const lastActivities = (await get('/sync/last_activities', token)).data as AnyRec
  return { applied, sent, tally, lastActivities }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, key)

  let body: { action?: Action; code?: string; redirectUri?: string; state?: string; full?: boolean; force?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }

  // Who is calling: the cron (secret → the single user, sync only) or a signed-in browser.
  let userId: string
  let fromCron = false
  const cronSecret = Deno.env.get('TRAKT_SYNC_SECRET')
  const sentSecret = req.headers.get('x-sync-secret')
  if (sentSecret) {
    if (!cronSecret || sentSecret !== cronSecret) return json({ error: 'Invalid sync secret' }, 401)
    const owner = Deno.env.get('HEVY_USER_ID')
    if (!owner) return json({ error: 'HEVY_USER_ID is not set' }, 500)
    userId = owner
    fromCron = true
    body.action = 'sync'
  } else {
    const authHeader = req.headers.get('authorization')
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401)
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
    if (authError || !user) return json({ error: 'Invalid token' }, 401)
    userId = user.id
  }
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
      const { data: state } = await supabase.from('trakt_sync_state').select('*').eq('user_id', userId).maybeSingle()
      const st = (state ?? {}) as AnyRec
      const { count } = await supabase.from('trakt_outbox').select('id', { count: 'exact', head: true }).eq('user_id', userId)
      return json({
        connected: !!tok,
        username: tok?.username ?? null,
        connectedAt: tok?.connected_at ?? null,
        lastSyncAt: st.last_sync_at ?? null,
        lastError: st.last_error ?? null,
        lastResult: st.last_result ?? null,
        pending: count ?? 0,
        syncing: !!st.sync_started_at && Date.now() - new Date(String(st.sync_started_at)).getTime() < 5 * 60_000,
      })
    }

    if (action === 'disconnect') {
      if (tok) {
        // Revoke on Trakt first; a failed revoke still removes our copy.
        await oauth('/oauth/revoke', { token: tok.access_token, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET() }).catch(() => null)
        const { error } = await supabase.from('trakt_tokens').delete().eq('user_id', userId)
        if (error) throw error
        // Changes queued for this connection would be stale on the next one.
        await supabase.from('trakt_outbox').delete().eq('user_id', userId)
      }
      return json({ connected: false })
    }

    if (!tok) return json(fromCron ? { skipped: 'not_connected' } : { error: 'not_connected' }, fromCron ? 200 : 400)

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
    const username = (tok.username as string) ?? null

    if (action === 'snapshot') {
      return json(await snapshot(accessToken, username))
    }

    if (action === 'import' || action === 'sync') {
      // Library writes carry x-trakt-sync so the outbox triggers skip them.
      const db = createClient(url, key, { global: { headers: { 'x-trakt-sync': '1' } } })
      if (!(await takeLock(db, userId))) return json({ busy: true })
      const now = new Date().toISOString()
      try {
        if (action === 'import') {
          const r = await runImport(db, userId, accessToken, username)
          const result = { kind: 'import', at: now, applied: r.applied, sent: r.sent, tally: r.tally }
          await stamp(db, userId, { last_sync_at: now, last_full_at: now, last_activities: r.lastActivities, last_error: null, last_result: result })
          return json(result)
        }
        const r = await runSync(db, userId, accessToken, username, { full: body.full, force: body.force })
        const result = { kind: 'sync', at: now, pulled: r.pulled, drained: r.drained, applied: r.applied ?? null, heldBack: r.heldBack ?? 0, kept: r.kept ?? 0 }
        await stamp(db, userId, {
          last_sync_at: now, ...(body.full ? { last_full_at: now } : {}), last_activities: r.lastActivities,
          last_error: r.drained.error ? `Sending to Trakt failed: ${r.drained.error}` : null, last_result: result,
        })
        return json(result)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        await stamp(db, userId, { last_error: message }).catch(() => null)
        throw e
      }
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
