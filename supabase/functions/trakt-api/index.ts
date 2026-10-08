// trakt-api — the app's door to Trakt (docs/trakt/PLAN.md).
//
// Connect (OAuth code exchange), status, disconnect (revoke), a read-only
// `snapshot` of everything Trakt holds, `import` (the first import: the
// outbox is sent, the app-only facts go to Trakt FIRST, then Trakt → library;
// only a fully successful import stamps `imported_at`) and `sync` (phases
// 3–4), which refuses to run until that first import has finished, since it
// treats Trakt as the truth and would otherwise wipe app-only data:
//   1. send the outbox — every app change to a Trakt-held fact, queued by the
//      migration-117 triggers — oldest first, at Trakt's one write per second;
//   2. read GET /sync/last_activities; only when something changed, read
//      Trakt and mirror it into the library (additions AND removals), leaving
//      alone any item whose change is still waiting in the outbox;
//   3. notes (migration 136): personal_note on a movie/show IS its Trakt note.
//      The outbox sends note changes one title at a time (POST/PUT/DELETE
//      /notes); the full three-way comparison (traktNotes.ts) runs when
//      Trakt's notes changed, on Sync now, at the import, and once after 136.
// The plans are pure modules in src/features/media/trakt/, GENERATED into the
// shared region further down by scripts/sync-trakt-shared.mjs. Library writes
// go through a client that sends `x-trakt-sync: 1`, which the outbox triggers
// skip, so the sync never queues its own writes.
//
// Follows: a follow's linked Trakt list gets the follow's new films; a film
// Trakt did not take (its 420 account limit, an error) waits in
// media_follows.pending_list_ids and is sent again at the next check.
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
  | 'ratings' | 'follows_check' | 'playback' | 'playback_remove' | 'calendar' | 'lists' | 'list_items' | 'list_create' | 'list_delete' | 'list_add' | 'list_remove' | 'list_reorder'

const API = 'https://api.trakt.tv'
const AUTHORIZE = 'https://trakt.tv/oauth/authorize'
const CLIENT_ID = () => Deno.env.get('TRAKT_CLIENT_ID') ?? ''
const CLIENT_SECRET = () => Deno.env.get('TRAKT_CLIENT_SECRET') ?? ''
// The only places Trakt may send the user back to (the Trakt app's own list).
const REDIRECTS = ['https://lasciviens.github.io/Project_Daily/', 'http://localhost:5173/Project_Daily/']

/** What Trakt answered, kept for the error report the app can copy (never a token). */
interface TraktDetail { path: string; status: number; body: string; at: string }

class TraktError extends Error {
  constructor(public status: number, message: string, public detail?: TraktDetail) { super(message) }
}

const WHAT: [RegExp, string][] = [
  [/\/notes/, 'your notes'],
  [/favorites/, 'your favorites'], [/watchlist/, 'your watchlist'], [/watched/, 'your watched history'],
  [/ratings/, 'your ratings'], [/playback/, 'Continue watching'], [/hidden\/dropped/, 'your dropped shows'],
  [/last_activities/, 'what changed on Trakt'], [/lists/, 'your lists'], [/calendars/, 'your calendar'],
  [/history/, 'your watch history'], [/oauth/, 'the sign-in'],
]

/** A Trakt failure in plain words — what we asked for, what went wrong, what to do. */
function traktFailure(path: string, status: number, body: string): TraktError {
  const clean = path.split('?')[0]
  const what = WHAT.find(([re]) => re.test(clean))?.[1] ?? 'Trakt'
  const message = status >= 500
    ? `Trakt's server failed while sending ${what} (HTTP ${status}). The problem is on Trakt's side and usually passes — try again in a few minutes.`
    : status === 403 ? `Trakt refused to send ${what} (HTTP 403) — the app's access may have been revoked; reconnect Trakt in Settings.`
    : status === 404 ? `Trakt could not find ${what} (HTTP 404).`
    : `Trakt rejected the request for ${what} (HTTP ${status}).`
  return new TraktError(status, message, { path: clean, status, body: body.replace(/\s+/g, ' ').slice(0, 300), at: new Date().toISOString() })
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
  if (!res.ok) throw traktFailure(path, res.status, text)
  return text ? JSON.parse(text) : {}
}

async function get(path: string, token: string): Promise<{ data: unknown; pages: number }> {
  let res = await fetch(`${API}${path}`, { headers: headers(token) })
  // A Trakt 5xx is often a blip: one retry before giving up.
  if (res.status >= 500) { await sleep(1500); res = await fetch(`${API}${path}`, { headers: headers(token) }) }
  if (res.status === 429) throw new TraktError(429, 'Trakt rate limit reached — try again in a few minutes')
  if (!res.ok) throw traktFailure(path, res.status, await res.text().catch(() => ''))
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

/** One write. Trakt allows 1 write per second; a 429 waits Retry-After once. */
async function write(method: 'POST' | 'PUT', path: string, token: string, body: AnyRec): Promise<AnyRec> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, { method, headers: headers(token), body: JSON.stringify(body) })
    if (res.status === 429 && attempt === 0) {
      await sleep((Number(res.headers.get('Retry-After')) || 2) * 1000)
      continue
    }
    if (res.status === 420) {
      // X-Account-Limit names the limit (API blueprint, 420 example); it may be absent.
      const limit = res.headers.get('X-Account-Limit')
      throw new TraktError(420, `Trakt account limit reached${limit ? ` (limit ${limit})` : ''} — a free account has a small number of lists, list items and notes; see your Trakt settings`)
    }
    if (!res.ok) throw traktFailure(path, res.status, await res.text().catch(() => ''))
    const text = await res.text()
    await sleep(1100)
    return text ? JSON.parse(text) : {}
  }
}
function post(path: string, token: string, body: AnyRec): Promise<AnyRec> { return write('POST', path, token, body) }
function put(path: string, token: string, body: AnyRec): Promise<AnyRec> { return write('PUT', path, token, body) }

/** One DELETE (also a write: one per second). */
async function del(path: string, token: string): Promise<void> {
  const res = await fetch(`${API}${path}`, { method: 'DELETE', headers: headers(token) })
  if (!res.ok && res.status !== 404) throw traktFailure(path, res.status, await res.text().catch(() => ''))
  await sleep(1100)
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
  // Reads that may fail without failing the whole snapshot; each failure is a warning.
  const warnings: string[] = []
  const optional = <T,>(label: string, p: Promise<T[]>): Promise<T[]> => p.catch(e => {
    warnings.push(`${label} could not be read: ${e instanceof Error ? e.message : String(e)}`)
    return [] as T[]
  })
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
    // Favorites and Continue watching are extras: a failure there must not
    // sink the whole read (Trakt answered 500 on /sync/favorites/movies/rank/asc).
    // The plain path is the one the sync already uses.
    optional('favorites', getAll('/sync/favorites/movies', token)),
    optional('favorites', getAll('/sync/favorites/shows', token)),
    getAll('/users/hidden/dropped?type=show', token, 100),
    optional('Continue watching', get('/sync/playback/movies', token).then(r => r.data as AnyRec[])),
    optional('Continue watching', get('/sync/playback/episodes', token).then(r => r.data as AnyRec[])),
  ])

  return {
    fetchedAt: new Date().toISOString(),
    username,
    warnings: [...new Set(warnings)],
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
  /** Optional reads that failed (favorites, Continue watching); the rest is complete. */
  warnings?: string[]
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
  /** The notes on movies and shows themselves (the `snapshot` action only; null = could not be read, see warnings). */
  notes?: TraktNote[] | null
}

interface TraktStatus {
  connected: boolean
  username: string | null
  connectedAt: string | null
  lastSyncAt: string | null
  lastError?: string | null
  /** The last sync/import result (trakt_sync_state.last_result). */
  lastResult?: {
    kind: 'import' | 'sync'; at: string; heldBack?: number; drained?: { left: number; notFound: number }
    /** Notes (migration 136): `warning` says why some stay in the app only (e.g. Trakt's note limit); `left` wait for the next sync. */
    notes?: { warning?: string | null; error?: string | null; left?: number } | null
  } | null
  /** Changes made here, waiting to be sent to Trakt. */
  pending: number
  syncing?: boolean
  notConfigured?: boolean
}

// ── The app's side, reduced to what matching needs ──────────────────────────
interface LocalMovie { tmdbId: number; title: string; year: number | null; status: string; repeatCount: number; rating: number | null; watchedAt?: string | null; watchlistRank?: number | null; note?: string | null }
interface LocalShow { tmdbId: number; title: string; year: number | null; status: string; rating: number | null; watchlistRank?: number | null; note?: string | null }
interface LocalEpisode { tmdbId: number; season: number; episode: number; repeatCount: number; watchedAt?: string | null }
interface LocalLibrary { movies: LocalMovie[]; shows: LocalShow[]; episodes: LocalEpisode[]; notes?: LocalNote[] }

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

// ── traktNotes.ts ──
// Trakt notes ↔ personal_note (docs/trakt/PLAN.md §12 has the API facts).
// Pure and import-free (scripts/verify-trakt-notes.cjs), shared into the
// trakt-api edge function by scripts/sync-trakt-shared.mjs.
//
// One note per title: personal_note on a movie or show entry IS the Trakt
// note attached to that movie or show itself (POST /notes with a movie or
// show object). Notes Trakt attaches to a play, a rating, a collection item,
// a season, an episode or a person are never read or written here, and
// episode notes stay app-only.
//
// The sync is three-way: trakt_note_text keeps the note as both sides held it
// at the last sync (null = no note on either side then), so a sync can tell
// which side changed it. The side that changed wins; when both changed,
// Trakt wins (the owner's import rule) — except that a note edited on one
// side is never lost to a delete on the other: the edit is kept. A title
// whose note change is still waiting in the outbox (key note:<type>:<tmdb>)
// is left alone until it has gone out.
//
// Length: Trakt keeps notes up to 500 characters. A longer note goes to Trakt
// cut to its first 499 characters + "…" (never splitting an emoji); the app
// keeps the whole note, and the two count as the same note.

const TRAKT_NOTE_MAX = 500
/** Trakt answering no notes of a type while this many here are linked is read as an outage. */
const NOTE_OUTAGE_LINKED = 3

type TraktNoteType = 'movie' | 'show'

/** The outbox key of a title's note (its own key: a waiting note never holds back the title's mirror). */
const traktNoteKey = (type: TraktNoteType, tmdb: number) => `note:${type}:${tmdb}`

/** The note as Trakt holds it: trimmed, line breaks as \n, cut to 500 characters. null = no note. */
function noteForTrakt(text: string | null | undefined): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\r\n?/g, '\n').trim()
  if (!t) return null
  if (t.length <= TRAKT_NOTE_MAX) return t
  let cut = TRAKT_NOTE_MAX - 1
  // Never end on the first half of a surrogate pair (an emoji).
  const last = t.charCodeAt(cut - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut--
  return `${t.slice(0, cut).trimEnd()}…`
}

/** One note attached to a movie or show itself, read from Trakt. */
interface TraktNote {
  type: TraktNoteType
  tmdb: number
  id: number
  text: string
  updatedAt: string | null
}

const isNewerNote = (a: TraktNote, b: TraktNote) =>
  (a.updatedAt ?? '') > (b.updatedAt ?? '') || ((a.updatedAt ?? '') === (b.updatedAt ?? '') && a.id > b.id)

/**
 * The rows of GET /users/me/notes/{movies|shows} (API blueprint, "Get
 * notes"): {attached_to: {type}, type, movie|show: {ids}, note: {id, notes,
 * updated_at}}. Keeps the notes attached to the movie or show itself, one per
 * title (the newest). `unreadable` counts rows without that shape — the
 * caller then leaves every note alone instead of reading a broken answer as
 * "no notes".
 */
function parseTraktNotes(rows: unknown, type: TraktNoteType): { notes: TraktNote[]; unreadable: number } {
  const best = new Map<number, TraktNote>()
  let unreadable = 0
  for (const raw of Array.isArray(rows) ? rows : []) {
    const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
    const attached = (r.attached_to && typeof r.attached_to === 'object' ? r.attached_to : null) as Record<string, unknown> | null
    const note = (r.note && typeof r.note === 'object' ? r.note : null) as Record<string, unknown> | null
    const id = Number(note?.id)
    if (!attached || typeof attached.type !== 'string' || typeof r.type !== 'string' || !note || !Number.isSafeInteger(id) || id <= 0) {
      unreadable++
      continue
    }
    // A note on a play, a rating or a collection item is not the title's own note.
    if (attached.type !== type || r.type !== type) continue
    const media = (r[type] && typeof r[type] === 'object' ? r[type] : null) as Record<string, unknown> | null
    const tmdb = Number((media?.ids as Record<string, unknown> | undefined)?.tmdb)
    // Without a TMDB id the title can't be found in the library.
    if (!Number.isSafeInteger(tmdb) || tmdb <= 0) continue
    const n: TraktNote = {
      type, tmdb, id,
      text: typeof note.notes === 'string' ? note.notes : '',
      updatedAt: typeof note.updated_at === 'string' ? note.updated_at : null,
    }
    const had = best.get(tmdb)
    if (!had || isNewerNote(n, had)) best.set(tmdb, n)
  }
  return { notes: [...best.values()], unreadable }
}

/** A library entry's note, as the sync sees it. */
interface LocalNote {
  type: TraktNoteType
  tmdb: number
  /** personal_note — the whole note, any length. */
  note: string | null
  /** trakt_note_id — the Trakt note it is linked to. */
  noteId: number | null
  /** trakt_note_text — the note as both sides held it at the last sync (null = no note on either side). */
  synced: string | null
}

type NoteRef = { type: TraktNoteType; tmdb: number }

type NoteAction =
  /** Write Trakt's note here (text null: Trakt deleted it, so it is cleared here). */
  | NoteRef & { kind: 'pull'; id: number | null; text: string | null; conflict?: true }
  /** Both sides hold the same text: keep the link only. */
  | NoteRef & { kind: 'link'; id: number; text: string }
  /** Neither side holds a note any more: drop a stale link. */
  | NoteRef & { kind: 'unlink' }
  /** Send the note here to Trakt: update note `id`, or add a note when id is null. */
  | NoteRef & { kind: 'push'; id: number | null; text: string; conflict?: true }
  /** The note was cleared here: delete Trakt's note `id`. */
  | NoteRef & { kind: 'remove'; id: number }

interface NotePlan {
  actions: NoteAction[]
  /** Titles left alone: a note change is still waiting to go out. */
  kept: string[]
  /** Same text on both sides, already linked. */
  same: number
  /** Changed on both sides since the last sync. */
  conflicts: number
  /** Of those, notes typed here that Trakt's text replaces (kept in the audit log, Developer → Activity). */
  replaced: number
  /** Trakt notes on titles not in the library (left on Trakt; a note alone never adds a title). */
  notInLibrary: number
  /** Set when Trakt answered no notes of that type while several here are linked: nothing is planned. */
  outage: TraktNoteType | null
}

function buildNotePlan(trakt: TraktNote[], local: LocalNote[], pending: Set<string>): NotePlan {
  const plan: NotePlan = { actions: [], kept: [], same: 0, conflicts: 0, replaced: 0, notInLibrary: 0, outage: null }
  for (const type of ['movie', 'show'] as const) {
    const linked = local.filter(l => l.type === type && l.noteId !== null).length
    if (linked >= NOTE_OUTAGE_LINKED && !trakt.some(t => t.type === type)) { plan.outage = type; return plan }
  }
  const theirs = new Map(trakt.map(t => [traktNoteKey(t.type, t.tmdb), t]))
  const mine = new Set<string>()
  for (const l of local) {
    const key = traktNoteKey(l.type, l.tmdb)
    mine.add(key)
    if (pending.has(key)) { plan.kept.push(key); continue }
    const t = theirs.get(key) ?? null
    const ref: NoteRef = { type: l.type, tmdb: l.tmdb }
    const here = noteForTrakt(l.note)
    const there = t ? noteForTrakt(t.text) : null
    const base = noteForTrakt(l.synced)

    if (here === there) {
      if (there === null) { if (l.noteId !== null || base !== null) plan.actions.push({ ...ref, kind: 'unlink' }) }
      else if (l.noteId !== t!.id || base !== there) plan.actions.push({ ...ref, kind: 'link', id: t!.id, text: there })
      else plan.same++
      continue
    }
    const changedHere = here !== base
    const changedThere = there !== base
    const conflict = changedHere && changedThere
    if (conflict) plan.conflicts++
    if (changedHere && (!changedThere || there === null)) {
      // Changed here only — or edited here while Trakt deleted it: the edit is kept.
      if (here === null) plan.actions.push({ ...ref, kind: 'remove', id: t!.id })
      else plan.actions.push({ ...ref, kind: 'push', id: t?.id ?? null, text: here, ...(conflict ? { conflict: true as const } : {}) })
    } else {
      // Changed on Trakt (or on both sides: Trakt wins).
      if (conflict && here !== null) plan.replaced++
      plan.actions.push({ ...ref, kind: 'pull', id: there === null ? null : t!.id, text: there, ...(conflict ? { conflict: true as const } : {}) })
    }
  }
  for (const key of theirs.keys()) if (!mine.has(key)) plan.notInLibrary++
  return plan
}

/** What the outbox drain does for one title: send this text (update note `id`, or add one), delete these notes. */
interface NoteDrainStep {
  send: { id: number | null; text: string } | null
  deletes: number[]
}

const validNoteId = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0

/**
 * The outbox drain, for one title's queued note changes (all at once): make
 * Trakt hold the note as it is here now. `local` = the entry now (null: it
 * left the library); `removedIds` = the Trakt note ids the queued removals
 * captured. A 404 on the update means the note is gone on Trakt: it is added
 * again (the caller's job).
 */
function noteDrainStep(local: { note: string | null; noteId: number | null; synced: string | null } | null, removedIds: number[]): NoteDrainStep {
  const ids = [...new Set([local?.noteId, ...removedIds].filter(validNoteId))]
  const text = local ? noteForTrakt(local.note) : null
  if (text === null) return { send: null, deletes: ids }
  // Reuse the linked note, else the newest one a queued removal captured (same title).
  const target = validNoteId(local?.noteId) ? local!.noteId! : ids.length ? ids[ids.length - 1] : null
  const deletes = ids.filter(x => x !== target)
  // Already on Trakt exactly like this: nothing to send.
  if (target !== null && target === local?.noteId && noteForTrakt(local.synced) === text) return { send: null, deletes }
  return { send: { id: target, text }, deletes }
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
//   · a movie with plays on Trakt is Completed (a Dropped movie stays Dropped)
//   · a movie half-watched on Trakt (Continue watching, no plays) comes in as
//     Watching; so does a show with only a paused episode and no entry here
//   · an item with a change still waiting in the outbox is left alone: the
//     outbox sends it, so neither side is written here (no doubled plays)
//   · a watched show whose seasons Trakt left out of the answer keeps its own
//     episodes here (never deleted, never re-sent, status kept)

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

const itemKey = {
  movie: (tmdb: number) => `movie:${tmdb}`,
  show: (tmdb: number) => `show:${tmdb}`,
  episode: (tmdb: number, season: number, episode: number) => `ep:${tmdb}:${season}:${episode}`,
}

const sameTime = (a: string | null | undefined, b: string | null | undefined) =>
  (a ? Date.parse(a) : null) === (b ? Date.parse(b) : null)

/** Titles half-watched on Trakt (Continue watching), by TMDB id. */
function playbackIds(snap: TraktSnapshot): { movies: Map<number, TraktItem>; shows: Map<number, TraktItem> } {
  const movies = new Map<number, TraktItem>()
  const shows = new Map<number, TraktItem>()
  for (const p of snap.playback ?? []) {
    const id = p.item.ids.tmdb
    if (!id || !(p.progress > 0)) continue
    if (p.item.type === 'movie') movies.set(id, p.item)
    else shows.set(id, p.item)
  }
  return { movies, shows }
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

function buildImportPlan(snap: TraktSnapshot, local: LocalLibrary, info: Map<number, ShowInfo>, pending: Set<string> = new Set()): ImportPlan {
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
  const pb = playbackIds(snap)
  for (const i of pb.movies.values()) note(i)
  for (const i of pb.shows.values()) note(i)
  const tWatched = new Map<number, TraktSnapshot['watchedMovies'][number]>()
  for (const w of snap.watchedMovies) if (w.item.ids.tmdb) { tWatched.set(w.item.ids.tmdb, w); note(w.item) }
  const lMovies = new Map(local.movies.map(m => [m.tmdbId, m]))
  const movieKeys = new Set<number>([...tWatched.keys(), ...lMovies.keys(), ...pb.movies.keys()])
  for (const [k, w] of watchlist) if (w.item.type === 'movie') movieKeys.add(Number(k.split(':')[1]))

  const movies: MovieWrite[] = []
  for (const id of movieKeys) {
    if (pending.has(itemKey.movie(id))) continue
    const t = tWatched.get(id)
    const l = lMovies.get(id)
    const wl = watchlist.get(`movie:${id}`)
    const r = ratings.get(`movie:${id}`)
    const watched = !!t || l?.status === 'completed'
    let status: string
    if (t) status = l?.status === 'dropped' ? 'dropped' : 'completed'
    else if (l?.status === 'completed') status = 'completed'
    else if (l && KEEP_MOVIE.has(l.status)) status = l.status
    else if (pb.movies.has(id)) status = 'watching'
    else if (wl || l?.status === 'wishlist') status = 'wishlist'
    else if (l) status = l.status
    else continue
    const listed = status === 'wishlist' || status === 'upcoming'
    const playCount = t ? t.plays : l ? playsOf(l.repeatCount) : 0
    const rating = r?.rating ?? l?.rating ?? null
    movies.push({
      tmdbId: id, item: t?.item ?? wl?.item ?? r?.item ?? pb.movies.get(id) ?? null, status,
      repeatCount: watched ? Math.max(0, playCount - 1) : 0,
      watchedAt: t ? movieWatchedAt(t.lastWatchedAt) : movieWatchedAt(l?.watchedAt),
      rating, watchlistRank: listed ? wl?.rank ?? null : null,
    })
    if (l?.status === 'completed' && !t) push.history.movies.push(...playEntries({ tmdb: id }, l.watchedAt ?? null, playsOf(l.repeatCount), snap.fetchedAt))
    if (l?.rating != null && !r) push.ratings.movies.push({ tmdb: id, rating: l.rating })
    if (listed && !wl) push.watchlistAdd.movies.push({ tmdb: id })
    if (wl && !listed) push.watchlistRemove.movies.push({ tmdb: id })
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
  for (const id of pb.shows.keys()) if (!lShows.has(id)) showKeys.add(id)

  const shows: ShowWrite[] = []
  const episodes: EpisodeWrite[] = []
  for (const id of showKeys) {
    const t = tShows.get(id)
    const l = lShows.get(id)
    const mine = lEps.get(id) ?? new Map()
    const wl = watchlist.get(`show:${id}`)
    const r = ratings.get(`show:${id}`)
    // Watched on Trakt but no seasons in the answer: Trakt's episodes are unknown.
    const epsUnknown = !!t && t.episodes.length === 0

    const union = new Set<string>(mine.keys())
    for (const [season, episode, plays, at] of t?.episodes ?? []) {
      const key = `${season}x${episode}`
      union.add(key)
      if (pending.has(itemKey.episode(id, season, episode))) continue
      const have = mine.get(key)
      if (!have || 1 + have.repeatCount !== plays || (at && !sameTime(at, have.watchedAt))) {
        episodes.push({ tmdbId: id, season, episode, repeatCount: Math.max(0, plays - 1), watchedAt: at ?? t?.lastWatchedAt ?? snap.fetchedAt })
      }
    }
    const theirs = new Set((t?.episodes ?? []).map(([s, e]) => `${s}x${e}`))
    if (!epsUnknown) {
      for (const [key, v] of mine) {
        if (theirs.has(key)) continue
        const [season, episode] = key.split('x').map(Number)
        if (pending.has(itemKey.episode(id, season, episode))) continue
        push.history.episodes.push(...playEntries({ tmdb: id, season, episode }, v.watchedAt, playsOf(v.repeatCount), snap.fetchedAt))
      }
    }
    if (pending.has(itemKey.show(id))) continue

    const isDropped = dropped.has(id) || l?.status === 'dropped'
    if (l?.status === 'dropped' && !dropped.has(id)) push.droppedAdd.shows.push({ tmdb: id })
    const regular = [...union].filter(k => !k.startsWith('0x')).length
    const aired = epsUnknown ? undefined : info.get(id)?.aired
    let status: string
    if (union.size || epsUnknown) {
      // Without TMDB's aired count nothing is known about "finished": keep the
      // status the show has (a Completed show must never drop to Watching).
      status = isDropped ? 'dropped'
        : aired === undefined ? (l && IN_PROGRESS_SHOW.has(l.status) ? l.status : 'watching')
        : aired > 0 && regular >= aired ? 'completed'
        : l?.status === 'paused' ? 'paused' : 'watching'
    } else if (isDropped) status = 'dropped'
    else if (l && IN_PROGRESS_SHOW.has(l.status)) status = l.status
    else if (!l && pb.shows.has(id)) status = 'watching'
    else if (wl || l?.status === 'wishlist') status = 'wishlist'
    else if (l) status = l.status
    else continue

    shows.push({
      tmdbId: id, item: t?.item ?? wl?.item ?? r?.item ?? pb.shows.get(id) ?? null, status,
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
// App-only facts are never touched: a Paused or Dropped show, a Dropped or
// Upcoming movie, a Watching movie without plays, a show marked Watching or
// Completed without episode rows, priority, plans. A movie with plays on
// Trakt is Completed (Dropped stays). A title half-watched on Trakt (Continue
// watching) with no entry here comes in as Watching. A watched show whose
// seasons Trakt left out keeps its own episodes. An entry is only ever
// deleted when every fact it holds belongs to Trakt and Trakt no longer has
// any of them — and never while it carries a note.

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
  /**
   * Show writes as they would be if this run's removals were held back: a
   * show's status counted without the episodes Trakt dropped (null = no write).
   */
  showsWithoutRemovals: Record<number, ShowWrite | null>
}

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
    // No seasons in Trakt's answer: its episodes are unknown, nothing to settle.
    if (!theirs.size) continue
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
  const plan: SyncPlan = { movies: [], shows: [], episodes: [], movieDeletes: [], showDeletes: [], episodeDeletes: [], ids: [], kept: [], showsWithoutRemovals: {} }
  const pb = playbackIds(snap)
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
  const movieKeys = new Set<number>([...tWatched.keys(), ...lMovies.keys(), ...pb.movies.keys()])
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
      // Plays on Trakt = watched = Completed; Dropped is app-only and stays. The plays follow Trakt.
      const status = l?.status === 'dropped' ? 'dropped' : 'completed'
      w = { tmdbId: id, item: t.item, status, repeatCount: Math.max(0, t.plays - 1), watchedAt: movieWatchedAt(t.lastWatchedAt), rating, watchlistRank: null }
    } else if (l && (l.status === 'watching' || l.status === 'dropped')) {
      // App-only states (a Watching movie may be half-watched on Trakt): only the rating follows Trakt.
      w = { tmdbId: id, item: null, status: l.status, repeatCount: l.repeatCount, watchedAt: l.watchedAt ?? null, rating, watchlistRank: null }
    } else if (pb.movies.has(id)) {
      // Half-watched on Trakt (Continue watching), no plays: Watching.
      w = { tmdbId: id, item: pb.movies.get(id)!, status: 'watching', repeatCount: 0, watchedAt: null, rating, watchlistRank: null }
    } else if (wl) {
      w = { tmdbId: id, item: wl.item, status: l?.status === 'upcoming' ? 'upcoming' : 'wishlist', repeatCount: 0, watchedAt: null, rating, watchlistRank: wl.rank }
    } else if (l?.status === 'upcoming') {
      // Upcoming is the app's own state (Trakt may not know the title yet): kept.
      w = { tmdbId: id, item: null, status: 'upcoming', repeatCount: 0, watchedAt: null, rating, watchlistRank: l.watchlistRank ?? null }
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
  const lEps = new Map<number, Map<string, { repeatCount: number; watchedAt: string | null }>>()
  for (const e of local.episodes) {
    const m = lEps.get(e.tmdbId) ?? new Map<string, { repeatCount: number; watchedAt: string | null }>()
    m.set(`${e.season}x${e.episode}`, { repeatCount: e.repeatCount, watchedAt: e.watchedAt ?? null })
    lEps.set(e.tmdbId, m)
  }
  const showKeys = new Set<number>([...tShows.keys(), ...lShows.keys(), ...lEps.keys(), ...dropped.keys()])
  for (const [k, w] of watchlist) if (w.item.type === 'show') showKeys.add(Number(k.split(':')[1]))
  for (const id of pb.shows.keys()) if (!lShows.has(id)) showKeys.add(id)

  for (const id of showKeys) {
    const t = tShows.get(id)
    const l = lShows.get(id)
    const mine = lEps.get(id) ?? new Map<string, { repeatCount: number; watchedAt: string | null }>()
    const wl = watchlist.get(`show:${id}`)
    const rating = ratings.get(`show:${id}`)?.rating ?? null
    const showKey = itemKey.show(id)
    const showPending = pending.has(showKey)
    // Watched on Trakt but no seasons in the answer: its episodes are unknown,
    // so every local episode stays and the status is not recounted.
    const epsUnknown = !!t && t.episodes.length === 0

    // Episodes: Trakt's set, except those with a change still waiting to go out.
    const finalEps = new Set<string>()
    const removed = new Set<string>()
    const epWrites: EpisodeWrite[] = []
    const theirs = new Set<string>()
    for (const [season, episode, plays, at] of t?.episodes ?? []) {
      const k = `${season}x${episode}`
      theirs.add(k)
      const ek = itemKey.episode(id, season, episode)
      if (pending.has(ek)) { plan.kept.push(ek); if (mine.has(k)) finalEps.add(k); continue }
      finalEps.add(k)
      const have = mine.get(k)
      const repeatCount = Math.max(0, plays - 1)
      if (!have || have.repeatCount !== repeatCount || (at && !sameTime(at, have.watchedAt))) {
        epWrites.push({ tmdbId: id, season, episode, repeatCount, watchedAt: at ?? t?.lastWatchedAt ?? snap.fetchedAt })
      }
    }
    for (const k of mine.keys()) {
      if (theirs.has(k)) continue
      if (epsUnknown) { finalEps.add(k); continue }
      const [season, episode] = k.split('x').map(Number)
      const ek = itemKey.episode(id, season, episode)
      if (pending.has(ek)) { plan.kept.push(ek); finalEps.add(k); continue }
      plan.episodeDeletes.push({ tmdbId: id, season, episode })
      removed.add(k)
    }

    if (showPending) {
      plan.kept.push(showKey)
      // Episodes need an entry to hang on; a pending show without one waits.
      if (l) plan.episodes.push(...epWrites)
      continue
    }

    const isDropped = dropped.has(id) || l?.status === 'dropped'
    const aired = epsUnknown ? undefined : info.get(id)?.aired
    const statusFor = (eps: Set<string>): string | null => {
      const regular = [...eps].filter(k => !k.startsWith('0x')).length
      if (eps.size || epsUnknown) {
        if (isDropped) return 'dropped'
        if (aired !== undefined) return aired > 0 && regular >= aired ? 'completed' : l?.status === 'paused' ? 'paused' : 'watching'
        return l && IN_PROGRESS_SHOW.has(l.status) ? l.status : 'watching'
      }
      if (isDropped) return 'dropped'
      if (l && IN_PROGRESS_SHOW.has(l.status)) return l.status
      if (!l && pb.shows.has(id)) return 'watching'
      if (wl) return 'wishlist'
      return null
    }
    const writeFor = (status: string): ShowWrite | null => {
      const w: ShowWrite = {
        tmdbId: id, item: t?.item ?? wl?.item ?? dropped.get(id) ?? pb.shows.get(id) ?? null, status, rating,
        watchlistRank: status === 'wishlist' ? wl?.rank ?? null : null,
      }
      if (!l) return w
      return w.status !== l.status || w.rating !== (l.rating ?? null)
        || (l.watchlistRank !== undefined && w.watchlistRank !== (l.watchlistRank ?? null)) ? w : null
    }

    const status = statusFor(finalEps)
    if (status === null && !l) continue
    if (status === null) {
      // Wishlisted here, and Trakt holds none of it any more.
      if (l!.note) plan.kept.push(showKey)
      else plan.showDeletes.push(id)
      continue
    }

    const w = writeFor(status)
    if (w) { plan.shows.push(w); if (!l) noteNew(w.item) }
    if (removed.size && l) {
      // If these removals wait for a confirm, the status must not move yet.
      const held = statusFor(new Set([...finalEps, ...removed]))
      plan.showsWithoutRemovals[id] = held ? writeFor(held) : null
    }
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

/**
 * The plan with its removals held back. A show whose status was counted
 * without the removed episodes gets the status it has with them (usually: no
 * change at all), so a held-back removal never moves a show's status.
 */
function withoutRemovals(p: SyncPlan): SyncPlan {
  const held = p.showsWithoutRemovals ?? {}
  const shows = p.shows.filter(s => !(s.tmdbId in held))
  for (const w of Object.values(held)) if (w) shows.push(w)
  return { ...p, shows, movieDeletes: [], showDeletes: [], episodeDeletes: [] }
}

/**
 * Whether Trakt changed since the last run (GET /sync/last_activities), and
 * whether any of its `reset_at` stamps moved — a watched-progress reset on
 * Trakt is read as needing a full mirror (every show's status re-checked).
 */
function lastActivitiesChange(prev: unknown, next: unknown): { changed: boolean; reset: boolean } {
  const resets = (o: unknown, path = '', out = new Map<string, string>()) => {
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        if (k.endsWith('reset_at') && (typeof v === 'string' || v === null)) out.set(`${path}.${k}`, String(v))
        else resets(v, `${path}.${k}`, out)
      }
    }
    return out
  }
  const a = resets(prev)
  const b = resets(next)
  const reset = [...b].some(([k, v]) => v !== 'null' && a.get(k) !== v)
  const all = (o: unknown) => (o && typeof o === 'object' ? (o as Record<string, unknown>).all : undefined)
  const changed = reset || !all(prev) || !all(next) || all(prev) !== all(next)
  return { changed, reset }
}

// ── followRules.ts ──
// What's new in a follow (media_follows → media_follow_events): the one rule
// for what counts as a NEW FILM, and which films still wait for the follow's
// Trakt list. Pure and import-free: trakt-api uses it when it writes events
// (copied in by scripts/sync-trakt-shared.mjs) and the app uses it when it
// shows them, so rows written under older rules stop showing at once.
// Verified by scripts/verify-media-follows.cjs.
//
// Root cause it fixes: "new" used to mean "not seen in TMDB's list before".
// TMDB lists change for old films all the time — a person gets a late credit
// (an uncredited cameo in Avengers: Endgame), a keyword or studio is tagged
// onto an old film, a studio's "newest 100" window shifts — so long-released
// films were reported as new. Now a title is new only by its OWN date, and
// only feature films count (no documentaries, TV movies, direct-to-video
// compilations, shorts, adult titles, cameos as oneself or archive footage).

/** TMDB movie genres that are not feature films for this feed: Documentary, TV Movie. */
const FOLLOW_NON_FEATURE_GENRES = [99, 10770]
/** A film released at most this many days before the check (or before the event was written) is still "new". */
const FOLLOW_NEW_WINDOW_DAYS = 30
/** TMDB runtimes below this are shorts. */
const FOLLOW_SHORT_MINUTES = 40

/** The fields TMDB returns on a movie in collection parts, /discover/movie and /person/{id}/movie_credits. */
interface FollowCandidate {
  id?: number
  adult?: boolean | null
  video?: boolean | null
  media_type?: string | null
  genre_ids?: number[] | null
  release_date?: string | null
  poster_path?: string | null
  character?: string | null
  job?: string | null
}

// A cast credit that isn't a role in the film: playing oneself, archive
// footage, an uncredited cameo, or narrating.
const FOLLOW_NOT_A_ROLE = [
  /^\s*(self|himself|herself|themselves|themself)\b/i,
  /\barchive(d)?\s+footage\b/i,
  /\(uncredited\)/i,
  /^\s*narrator\b/i,
]

/** Why a candidate is not a feature film for this follow kind, or null when it is one. */
function followRejectReason(r: FollowCandidate, kind: string): string | null {
  if (r.media_type && r.media_type !== 'movie') return 'not_movie'
  if (r.adult) return 'adult'
  if (r.video) return 'video'
  if ((r.genre_ids ?? []).some(g => FOLLOW_NON_FEATURE_GENRES.includes(g))) return 'non_feature_genre'
  if (!r.release_date && !r.poster_path) return 'stub'
  if (kind === 'director' && r.job !== 'Director') return 'not_director'
  if (kind === 'actor' && FOLLOW_NOT_A_ROLE.some(re => re.test(String(r.character ?? '')))) return 'not_a_role'
  return null
}

const isFollowFeature = (r: FollowCandidate, kind: string) => followRejectReason(r, kind) === null

const FOLLOW_DAY_MS = 864e5
const followDayOf = (iso: string) => iso.slice(0, 10)
function followMinusDays(isoDay: string, days: number): string {
  return new Date(Date.parse(`${isoDay.slice(0, 10)}T00:00:00Z`) - days * FOLLOW_DAY_MS).toISOString().slice(0, 10)
}

/**
 * True when a film with this release date is new as of `asOf` (an ISO date or
 * timestamp): not out yet, out within the last FOLLOW_NEW_WINDOW_DAYS days, or
 * announced without a date. A film released earlier is never new, however late
 * TMDB lists it.
 */
function isNewByDate(release: string | null | undefined, asOf: string): boolean {
  if (!release) return true
  return release.slice(0, 10) >= followMinusDays(followDayOf(asOf), FOLLOW_NEW_WINDOW_DAYS)
}

/** Details (/movie/{id}) say it isn't a coming feature film: a short, or cancelled. Missing values never reject. */
function followDetailsReject(d: { runtime?: number | null; status?: string | null } | null | undefined): string | null {
  if (!d) return null
  if (typeof d.runtime === 'number' && d.runtime > 0 && d.runtime < FOLLOW_SHORT_MINUTES) return 'short'
  if (String(d.status ?? '').toLowerCase() === 'canceled') return 'canceled'
  return null
}

/** Only real trailers: TMDB's 'Trailer' type on YouTube, not marked unofficial (teasers, clips, featurettes, bloopers… are left out). */
function isFollowTrailer(v: { site?: string | null; type?: string | null; official?: boolean | null; key?: string | null }): boolean {
  return v.site === 'YouTube' && v.type === 'Trailer' && v.official !== false && !!v.key
}

/** A stored event the app still shows: its title was new (or upcoming) on the day the event was written. */
function isShowableFollowEvent(e: { release_date: string | null; created_at: string }): boolean {
  return isNewByDate(e.release_date, e.created_at)
}

// ── The follow's linked Trakt list (media_follows.pending_list_ids, 136) ─────
// The list holds the follow's whole filmography: every film TMDB lists for the
// first time goes onto it. A film Trakt has not taken yet (its 420 account
// limit, an error, no Trakt sign-in at hand) waits in pending_list_ids and is
// sent again at the next check — it is never counted as done before Trakt
// took it.

/**
 * The films to send at this check: the ones still waiting, then the ones
 * TMDB lists for the first time. A waiting film TMDB no longer lists for the
 * follow is dropped — unless TMDB listed nothing (`listed` null or empty: a
 * bad answer never empties the queue).
 */
function followListToSend(pending: number[], fresh: number[], listed: Set<number> | null): number[] {
  const keep = listed && listed.size ? pending.filter(id => listed.has(id)) : pending
  return [...new Set([...keep, ...fresh])].filter(id => Number.isSafeInteger(id) && id > 0)
}

/** One attempt at the list: the ids in send order, how many of them (from the start) Trakt took, and its not_found answer. */
interface FollowListAttempt {
  ids: number[]
  accepted: number
  notFound: number[]
}

/**
 * What still waits after the attempt: every film not taken (a failed request
 * and everything after it), and a film Trakt said it doesn't know only while
 * it is still new by its own date (`stillNew`) — Trakt may not have added a
 * brand-new film yet. A film Trakt took is done.
 */
function followListPending(a: FollowListAttempt, stillNew: Set<number>): number[] {
  const taken = new Set(a.ids.slice(0, a.accepted))
  const left = a.ids.slice(a.accepted)
  for (const id of a.notFound) if (taken.has(id) && stillNew.has(id)) left.push(id)
  return [...new Set(left)]
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

/**
 * tmdb_id → catalogue row id, creating rows the library doesn't have yet from
 * TMDB. `failed` says why a title could not be created (it is retried on the
 * next run and listed in trakt_unmatched meanwhile).
 */
async function catalogIds(db: Db, table: 'movies' | 'tv_series', ids: number[], details: Map<number, AnyRec>): Promise<{ map: Map<number, string>; failed: Map<number, string> }> {
  const map = new Map<number, string>()
  const failed = new Map<number, string>()
  for (const part of chunk(ids, 200)) {
    const { data, error } = await db.from(table).select('id, tmdb_id').in('tmdb_id', part)
    if (error) throw error
    for (const r of data ?? []) map.set(Number(r.tmdb_id), String(r.id))
  }
  const missing = ids.filter(id => !map.has(id))
  if (missing.length && !TMDB_KEY()) {
    for (const id of missing) failed.set(id, 'TMDB_API_KEY is not set on the trakt-api function')
    return { map, failed }
  }
  await pool(missing, 4, async id => {
    try {
      const d = details.get(id) ?? await tmdb(`/${table === 'movies' ? 'movie' : 'tv'}/${id}`)
      const { data, error } = await db.from(table).upsert(table === 'movies' ? movieRow(d) : showRow(d), { onConflict: 'tmdb_id' }).select('id').single()
      if (error) throw error
      map.set(id, String(data.id))
    } catch (e) {
      if (e instanceof TmdbKeyError) throw e
      failed.set(id, e instanceof Error ? e.message : String((e as AnyRec)?.message ?? e))
    }
  })
  return { map, failed }
}

interface Writes {
  movies: MovieWrite[]; shows: ShowWrite[]; episodes: EpisodeWrite[]
  movieDeletes?: number[]; showDeletes?: number[]; episodeDeletes?: EpisodeRef[]
}

/** A title that could not be added this run (its catalogue row could not be created). */
interface Unadded { kind: 'movie' | 'show'; tmdbId: number; item: TraktItem | null; reason: string }

async function applyWrites(db: Db, userId: string, local: Local, w: Writes, details: Map<number, AnyRec>) {
  const now = new Date().toISOString()
  const done = { movies: 0, shows: 0, episodes: 0, removed: 0, skippedNew: 0, skippedEpisodes: 0 }
  const unadded: Unadded[] = []

  const movieIds = new Map([...local.movieEntry].map(([k, v]) => [k, v.movieId]))
  const newMovies = w.movies.map(m => m.tmdbId).filter(id => !movieIds.has(id))
  const mc = await catalogIds(db, 'movies', newMovies, new Map())
  for (const [k, v] of mc.map) movieIds.set(k, v)
  const mRows = w.movies.flatMap(m => {
    const movieId = movieIds.get(m.tmdbId)
    if (!movieId) {
      done.skippedNew++
      unadded.push({ kind: 'movie', tmdbId: m.tmdbId, item: m.item, reason: `TMDB lookup failed: ${mc.failed.get(m.tmdbId) ?? 'no catalogue row'}` })
      return []
    }
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
  const sc = await catalogIds(db, 'tv_series', newShows, details)
  for (const [k, v] of sc.map) seriesIds.set(k, v)
  const sRows = w.shows.flatMap(s => {
    const seriesId = seriesIds.get(s.tmdbId)
    if (!seriesId) {
      done.skippedNew++
      unadded.push({ kind: 'show', tmdbId: s.tmdbId, item: s.item, reason: `TMDB lookup failed: ${sc.failed.get(s.tmdbId) ?? 'no catalogue row'}` })
      return []
    }
    return [{ user_id: userId, tv_series_id: seriesId, status: s.status, rating: s.rating, watchlist_rank: s.watchlistRank, trakt_synced_at: now }]
  })
  for (const part of chunk(sRows, 500)) {
    const { data, error } = await db.from('user_tv_entries').upsert(part, { onConflict: 'user_id,tv_series_id' }).select('id, tv_series_id')
    if (error) throw error
    for (const r of data ?? []) entryBySeries.set(String(r.tv_series_id), String(r.id))
    done.shows += part.length
  }

  // An episode whose show has no entry (its catalogue row failed, or the show
  // waits in the outbox) is counted, never silently dropped.
  const eRows = w.episodes.flatMap(e => {
    const seriesId = seriesIds.get(e.tmdbId)
    const entryId = seriesId && entryBySeries.get(seriesId)
    if (!seriesId || !entryId) { done.skippedEpisodes++; return [] }
    return [{ user_id: userId, tv_entry_id: entryId, tv_series_id: seriesId, season_number: e.season,
      episode_number: e.episode, watched_at: e.watchedAt, repeat_count: e.repeatCount }]
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
  return { done, unadded }
}

// ── trakt_unmatched (migration 116) ──────────────────────────────────────────
// Trakt items this app could not take in: no TMDB id on Trakt (never guessed),
// or a TMDB lookup that failed (retried every run). Rewritten on every run
// that reads Trakt, so a title that comes in later leaves the list.
async function recordUnmatched(db: Db, userId: string, snap: TraktSnapshot, unadded: Unadded[]): Promise<number> {
  const rows = new Map<string, AnyRec>()
  const add = (i: TraktItem | null, reason: string) => {
    if (!i || !i.ids.trakt) return
    rows.set(`${i.type}:${i.ids.trakt}`, { user_id: userId, kind: i.type, trakt_id: i.ids.trakt, title: i.title || 'Untitled', year: i.year, ids: i.ids, reason })
  }
  const all: TraktItem[] = [
    ...snap.watchedMovies.map(x => x.item), ...snap.watchedShows.map(x => x.item), ...snap.watchlist.map(x => x.item),
    ...snap.ratings.map(x => x.item), ...snap.favorites.map(x => x.item), ...snap.dropped.map(x => x.item), ...snap.playback.map(x => x.item),
  ]
  for (const i of all) if (i && !i.ids.tmdb) add(i, 'No TMDB id on Trakt — pick the title by hand')
  for (const u of unadded) add(u.item, `${u.reason} — retried on the next sync`)
  const { error: delError } = await db.from('trakt_unmatched').delete().eq('user_id', userId)
  if (delError) { if (['42P01', 'PGRST205'].includes(String(delError.code))) return 0; throw delError }
  for (const part of chunk([...rows.values()], 500)) {
    const { error } = await db.from('trakt_unmatched').upsert(part, { onConflict: 'user_id,kind,trakt_id' })
    if (error) throw error
  }
  return rows.size
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
  favorite_add: '/sync/favorites', favorite_remove: '/sync/favorites/remove',
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
    // A movie marked watched with no date is Trakt's "unknown date", which
    // Trakt itself stores and returns as the epoch.
    if (op === 'history_add' && !p.watched_at && p.type === 'movie') extra.watched_at = '1970-01-01T00:00:00.000Z'
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

/**
 * The next request: the first row's op, plus every later row of that op
 * (≤ 100) whose item has no earlier row still waiting — so "remove K1, add K1,
 * remove K2, add K2" goes as one remove and one add, and each item's own rows
 * still go in order.
 */
function pickBatch(rows: AnyRec[]): AnyRec[] {
  const op = rows[0].op
  const batch = [rows[0]]
  const blocked = new Set<string>()
  for (let k = 1; k < rows.length && batch.length < 100; k++) {
    const r = rows[k]
    const key = String(r.item_key)
    if (r.op === op && !blocked.has(key)) batch.push(r)
    else blocked.add(key)
  }
  return batch
}

async function drainOutbox(db: Db, userId: string, token: string, deadline: number) {
  const out = { sent: 0, notFound: 0, failed: 0, left: 0, error: null as string | null, notes: null as NoteDrain | null }
  const sentKeys: string[] = []
  // seq (migration 120) is the true insert order; created_at ties inside one trigger call.
  const base = () => db.from('trakt_outbox').select('id, op, item_key, payload, attempts')
    .eq('user_id', userId).lte('next_retry_at', new Date().toISOString())
  let res = await base().order('seq').limit(500)
  if (res.error && missingColumn(res.error)) res = await base().order('created_at').order('id').limit(500)
  if (res.error) throw res.error
  const waiting = (res.data ?? []) as AnyRec[]
  // Notes (136) go in their own pass, one title at a time: a note never waits
  // behind, or holds up, any other change.
  const noteRows = waiting.filter(r => NOTE_OPS.has(String(r.op)))
  let rows = waiting.filter(r => !NOTE_OPS.has(String(r.op)))
  let calls = 0
  while (rows.length && calls < 40 && Date.now() < deadline) {
    const batch = pickBatch(rows)
    const op = String(batch[0].op)
    const ids = batch.map(r => r.id)
    const path = OUTBOX_PATHS[op]
    try {
      if (path) {
        const sent = await post(path, token, outboxBody(op, batch))
        out.notFound += notFoundCount(sent)
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
    const taken = new Set(ids)
    rows = rows.filter(r => !taken.has(r.id))
  }
  if (noteRows.length) {
    const notes = await drainNotes(db, userId, token, noteRows, deadline)
    out.notes = notes.result
    sentKeys.push(...notes.keys)
  }
  const { count } = await db.from('trakt_outbox').select('id', { count: 'exact', head: true }).eq('user_id', userId)
  out.left = count ?? 0
  return { ...out, sentKeys }
}

// ── Notes (migration 136): personal_note ↔ the Trakt note on a movie/show ────
// API (checked 07.10.2026 — API blueprint "Notes" + trakt/trakt-api's contract,
// docs/trakt/PLAN.md §12): POST /notes {movie|show, notes} → 201 {id, …};
// PUT /notes/{id} {notes} → 200; DELETE /notes/{id} → 204; GET
// /users/me/notes/{movies|shows} (paginated) → [{attached_to, type, movie|show,
// note}]; ≤ 500 characters; a note on a movie/show is always private;
// 420 = the account's note limit (VIP: none); 404 = item not found;
// last_activities.notes.updated_at moves when any note changes.
const NOTE_OPS = new Set(['note_set', 'note_remove'])
const NOTE_TABLE = { movie: 'user_movie_entries', show: 'user_tv_entries' } as const
// Trakt takes one write per second and a run must end well inside the
// function's time limit, so notes go a few at a time; the rest wait for the
// next sync (every 30 minutes, or Sync now).
/** Titles the outbox drain sends per run (each is one or two Trakt writes). */
const NOTE_DRAIN_MAX = 15
/** Trakt writes one full comparison makes per run. */
const NOTE_SYNC_WRITES = 15
const NOTE_LIMIT = 'Trakt’s note limit for your account is reached (Trakt VIP has none): the notes Trakt doesn’t have stay in the app and are sent once there is room'

/** Trakt will not take it as sent: the note stays as it is (the next full comparison tries again). */
const isNoteRefusal = (e: unknown) => e instanceof TraktError && [404, 409, 420, 422].includes(e.status)

function noteFailureMessage(e: unknown): string {
  if (e instanceof TraktError) {
    if (e.status === 420) return NOTE_LIMIT
    if (e.status === 404) return 'Trakt doesn’t know a title by its TMDB id, so its note stays in the app only'
    if (e.status === 409) return 'Trakt would not delete a note (HTTP 409), so it stays on Trakt'
    if (e.status === 422) return 'Trakt refused a note’s text (HTTP 422), so it stays in the app only'
  }
  return e instanceof Error ? e.message : String((e as AnyRec)?.message ?? e)
}

/** Every note on a movie or show itself. A row this app can't read stops the comparison (never read as "no note"). */
async function readTraktNotes(token: string): Promise<TraktNote[]> {
  const out: TraktNote[] = []
  for (const type of ['movie', 'show'] as const) {
    const parsed = parseTraktNotes(await getAll(`/users/me/notes/${type}s`, token, 100), type)
    if (parsed.unreadable) {
      throw new Error(`Trakt sent your ${type} notes in a shape this app can’t read (${parsed.unreadable} entr${parsed.unreadable === 1 ? 'y' : 'ies'}) — no note was changed`)
    }
    out.push(...parsed.notes)
  }
  return out
}

interface NoteEntry { entryId: string; updatedAt: string | null; local: LocalNote }

/** Every movie and show entry's note fields, by note key. */
async function loadLocalNotes(db: Db, userId: string): Promise<Map<string, NoteEntry>> {
  const byKey = new Map<string, NoteEntry>()
  for (const type of ['movie', 'show'] as const) {
    const join = type === 'movie' ? 'c:movies(tmdb_id)' : 'c:tv_series(tmdb_id)'
    const rows = await allRows(() => db.from(NOTE_TABLE[type])
      .select(`id, personal_note, trakt_note_id, trakt_note_text, updated_at, ${join}`).eq('user_id', userId).order('id'))
    for (const r of rows) {
      const tmdb = Number(one(r.c)?.tmdb_id)
      if (!tmdb) continue
      byKey.set(traktNoteKey(type, tmdb), {
        entryId: String(r.id), updatedAt: (r.updated_at as string) ?? null,
        local: { type, tmdb, note: (r.personal_note as string) ?? null, noteId: r.trakt_note_id != null ? Number(r.trakt_note_id) : null, synced: (r.trakt_note_text as string) ?? null },
      })
    }
  }
  return byKey
}

/** One title's entry (null when the title is not in the library). */
async function readNoteEntry(db: Db, userId: string, type: TraktNoteType, tmdb: number) {
  const { data: c, error: ce } = await db.from(type === 'movie' ? 'movies' : 'tv_series').select('id').eq('tmdb_id', tmdb).maybeSingle()
  if (ce) throw ce
  if (!c) return null
  const { data, error } = await db.from(NOTE_TABLE[type]).select('id, personal_note, trakt_note_id, trakt_note_text')
    .eq('user_id', userId).eq(type === 'movie' ? 'movie_id' : 'tv_series_id', (c as AnyRec).id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as AnyRec
  return {
    entryId: String(r.id), note: (r.personal_note as string) ?? null,
    noteId: r.trakt_note_id != null ? Number(r.trakt_note_id) : null, synced: (r.trakt_note_text as string) ?? null,
  }
}

/** Stores (or clears) an entry's link to its Trakt note; false when the entry is gone. Never touches personal_note. */
async function writeNoteLink(db: Db, type: TraktNoteType, entryId: string, id: number | null, text: string | null): Promise<boolean> {
  const { data, error } = await db.from(NOTE_TABLE[type]).update({ trakt_note_id: id, trakt_note_text: text }).eq('id', entryId).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * Puts a note on Trakt: updates note `id` (a 404 means it is gone there, so
 * it is added again), or adds one to the movie/show by its TMDB id (Trakt
 * makes a movie/show note private by itself). Returns the note id — null
 * when Trakt's answer carried none (the next full comparison links it).
 */
async function sendNote(token: string, type: TraktNoteType, tmdb: number, id: number | null, text: string): Promise<number | null> {
  if (id) {
    try {
      const r = await put(`/notes/${id}`, token, { notes: text })
      const same = Number(r.id)
      return Number.isSafeInteger(same) && same > 0 ? same : id
    } catch (e) {
      if (!(e instanceof TraktError && e.status === 404)) throw e
    }
  }
  const r = await post('/notes', token, { [type]: { ids: { tmdb } }, notes: text })
  const added = Number(r.id)
  return Number.isSafeInteger(added) && added > 0 ? added : null
}

interface NoteDrain { sent: number; refused: number; failed: number; warning: string | null; error: string | null }

/**
 * The outbox's note changes, one title at a time: whatever was queued, Trakt
 * is made to hold the note as it is here NOW (noteDrainStep). A refusal
 * (note limit, unknown title) drops the change — the note stays in the app
 * and the next full comparison tries again; any other failure waits and is
 * retried, without holding up other titles.
 */
async function drainNotes(db: Db, userId: string, token: string, rows: AnyRec[], deadline: number): Promise<{ result: NoteDrain; keys: string[] }> {
  const result: NoteDrain = { sent: 0, refused: 0, failed: 0, warning: null, error: null }
  const keys: string[] = []
  const groups = new Map<string, AnyRec[]>()
  for (const r of rows) groups.set(String(r.item_key), [...(groups.get(String(r.item_key)) ?? []), r])
  const drop = async (ids: unknown[]) => {
    const { error } = await db.from('trakt_outbox').delete().in('id', ids)
    if (error) throw error
  }
  let limitReached = false
  let handled = 0
  for (const [key, group] of groups) {
    if (handled >= NOTE_DRAIN_MAX || Date.now() > deadline) break
    handled++
    const ids = group.map(r => r.id)
    const p = (group[0].payload ?? {}) as AnyRec
    const type: TraktNoteType = p.type === 'show' ? 'show' : 'movie'
    const tmdb = Number(p.tmdb)
    try {
      if (!Number.isSafeInteger(tmdb) || tmdb <= 0) { await drop(ids); continue }
      const removedIds = group.filter(r => r.op === 'note_remove').map(r => Number(((r.payload ?? {}) as AnyRec).note_id))
      const entry = await readNoteEntry(db, userId, type, tmdb)
      const step = noteDrainStep(entry, removedIds)
      // The limit is reached: adding another note now would only be refused again.
      if (step.send && step.send.id === null && limitReached) throw new TraktError(420, NOTE_LIMIT)
      for (const id of step.deletes) {
        await del(`/notes/${id}`, token)
        if (entry?.noteId === id) await writeNoteLink(db, type, entry.entryId, null, null)
      }
      if (step.send && entry) {
        const id = await sendNote(token, type, tmdb, step.send.id, step.send.text)
        // The title left the library meanwhile: its new note goes too.
        if (id !== null && !(await writeNoteLink(db, type, entry.entryId, id, step.send.text))) await del(`/notes/${id}`, token)
      }
      await drop(ids)
      result.sent++
      keys.push(key)
    } catch (e) {
      if (e instanceof TraktError && e.status === 401) throw e
      const message = noteFailureMessage(e)
      if (isNoteRefusal(e)) {
        if ((e as TraktError).status === 420) limitReached = true
        await drop(ids).catch(() => null)
        result.refused++
        result.warning = message
        keys.push(key) // not tried again in this run's comparison
        continue
      }
      const attempts = Number(group[0].attempts ?? 0) + 1
      await db.from('trakt_outbox').update({
        attempts, last_error: message,
        next_retry_at: new Date(Date.now() + Math.min(2 ** attempts, 60) * 60_000).toISOString(),
      }).in('id', ids)
      result.failed++
      result.error = message
    }
  }
  return { result, keys }
}

interface NoteSync {
  same: number; pulled: number; cleared: number; linked: number; sent: number; removed: number
  refused: number; conflicts: number; notInLibrary: number; left: number
  warning: string | null; complete: boolean
}
type NoteRun = NoteSync | { error: string; complete: false }

/**
 * The full note comparison (sync and import): Trakt's notes on movies and
 * shows vs personal_note, three-way through trakt_note_text (buildNotePlan).
 * Writes here first (no Trakt calls), then at most NOTE_SYNC_WRITES Trakt
 * writes; `complete` is false while some wait, so the next sync compares
 * again (notes_synced_at is only stamped when complete).
 */
async function syncNotes(db: Db, userId: string, token: string, pending: Set<string>, deadline: number): Promise<NoteSync> {
  const trakt = await readTraktNotes(token)
  const entries = await loadLocalNotes(db, userId)
  const plan = buildNotePlan(trakt, [...entries.values()].map(e => e.local), pending)
  const out: NoteSync = {
    same: plan.same, pulled: 0, cleared: 0, linked: 0, sent: 0, removed: 0, refused: 0,
    conflicts: plan.conflicts, notInLibrary: plan.notInLibrary, left: 0, warning: null, complete: true,
  }
  if (plan.outage) {
    return { ...out, complete: false, warning: `Trakt answered no ${plan.outage} notes while several here are on Trakt — read as an outage, so no note was changed` }
  }
  const entryOf = (a: NoteAction) => entries.get(traktNoteKey(a.type, a.tmdb))!

  // 1. Here: Trakt's notes, links, stale links.
  await pool(plan.actions.filter(a => a.kind === 'pull' || a.kind === 'link' || a.kind === 'unlink'), 5, async a => {
    const e = entryOf(a)
    if (a.kind === 'pull') {
      // Only while the entry is as it was read: a note typed meanwhile wins (the outbox sends it).
      const q = db.from(NOTE_TABLE[a.type]).update({ personal_note: a.text, trakt_note_id: a.id, trakt_note_text: a.text }).eq('id', e.entryId)
      const { data, error } = await (e.updatedAt ? q.eq('updated_at', e.updatedAt) : q.is('updated_at', null)).select('id')
      if (error) throw error
      if ((data ?? []).length) { if (a.text === null) out.cleared++; else out.pulled++ }
    } else if (a.kind === 'link') {
      await writeNoteLink(db, a.type, e.entryId, a.id, a.text)
      out.linked++
    } else {
      await writeNoteLink(db, a.type, e.entryId, null, null)
    }
  })

  // 2. Trakt: the notes changed here (pushes and removals), a few per run.
  let writes = 0
  let limitReached = false
  let failure: string | null = null
  for (const a of plan.actions) {
    if (a.kind !== 'push' && a.kind !== 'remove') continue
    if (writes >= NOTE_SYNC_WRITES || Date.now() > deadline) { out.left++; continue }
    const e = entryOf(a)
    try {
      if (a.kind === 'remove') {
        writes++
        await del(`/notes/${a.id}`, token)
        await writeNoteLink(db, a.type, e.entryId, null, null)
        out.removed++
        continue
      }
      if (limitReached && a.id === null) { out.refused++; continue }
      writes++
      const id = await sendNote(token, a.type, a.tmdb, a.id, a.text)
      if (id !== null && !(await writeNoteLink(db, a.type, e.entryId, id, a.text))) await del(`/notes/${id}`, token)
      out.sent++
    } catch (err) {
      if (err instanceof TraktError && err.status === 401) throw err
      failure = noteFailureMessage(err)
      if (!isNoteRefusal(err)) { out.left++; continue }
      if ((err as TraktError).status === 420) limitReached = true
      out.refused++
    }
  }
  if (out.left) out.complete = false
  const replaced = plan.replaced
    ? `${plan.replaced} note${plan.replaced === 1 ? ' was' : 's were'} different here and on Trakt — Trakt’s text was kept (the replaced text is in Developer → Activity)`
    : null
  out.warning = [failure, replaced].filter(Boolean).join(' · ') || null
  return out
}

/** The note comparison inside a sync or an import: a failure is reported, never fails the run (a 401 does: reconnect). */
async function runNotes(db: Db, userId: string, token: string, pending: Set<string>): Promise<NoteRun> {
  try {
    return await syncNotes(db, userId, token, pending, Date.now() + 30_000)
  } catch (e) {
    if (e instanceof TraktError && e.status === 401) throw e
    return { error: noteFailureMessage(e), complete: false }
  }
}

/** Migration 136 is in (notes need its trigger), and when notes were last compared in full (null = never). */
async function notesState(db: Db, userId: string): Promise<{ ready: boolean; syncedAt: string | null }> {
  const { data, error } = await db.from('trakt_sync_state').select('notes_synced_at').eq('user_id', userId).maybeSingle()
  if (error) { if (missingColumn(error)) return { ready: false, syncedAt: null }; throw error }
  return { ready: true, syncedAt: ((data as AnyRec | null)?.notes_synced_at as string) ?? null }
}

const notesActivity = (o: AnyRec | null | undefined) => (((o?.notes as AnyRec | undefined)?.updated_at as string | undefined) ?? null)

/** The notes part of a run's result (last_result.notes; the Trakt card shows its warning). */
function notesResult(drain: NoteDrain | null | undefined, full: NoteRun | null | undefined) {
  if (!drain && !full) return null
  const f = full && !('error' in full) ? full : null
  return {
    sent: (drain?.sent ?? 0) + (f?.sent ?? 0) + (f?.removed ?? 0),
    fromTrakt: (f?.pulled ?? 0) + (f?.cleared ?? 0),
    refused: (drain?.refused ?? 0) + (f?.refused ?? 0),
    conflicts: f?.conflicts ?? 0,
    left: f?.left ?? 0,
    warning: f?.warning ?? drain?.warning ?? null,
    error: (full && 'error' in full ? full.error : null) ?? drain?.error ?? null,
  }
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
    // Before 117/124/136: the newer columns don't exist yet.
    const rest = { ...row }
    for (const k of ['sync_started_at', 'last_result', 'imported_at', 'notes_synced_at']) delete rest[k]
    const retry = await db.from('trakt_sync_state').upsert(rest)
    if (retry.error) throw retry.error
  } else if (error) throw error
}

/**
 * Whether the first import has finished (migration 124's imported_at). Before
 * 124, last_full_at stands in: until now only an import or a full Sync now
 * wrote it. The sync never runs before this — it mirrors Trakt as the truth.
 */
async function hasImported(db: Db, userId: string): Promise<boolean> {
  const { data, error } = await db.from('trakt_sync_state').select('imported_at').eq('user_id', userId).maybeSingle()
  if (error && missingColumn(error)) {
    const old = await db.from('trakt_sync_state').select('last_full_at').eq('user_id', userId).maybeSingle()
    if (old.error) throw old.error
    return !!(old.data as AnyRec | null)?.last_full_at
  }
  if (error) throw error
  return !!(data as AnyRec | null)?.imported_at
}

const NOT_IMPORTED = 'Trakt sync is off until the first import has finished: Settings → Subscriptions → Trakt → Preview import → Import now. (Your changes wait and are sent by the import.)'

// ── Favorites mirror (phase 5) ───────────────────────────────────────────────
// Trakt → app for is_favorite. Kept out of the pure plan: a favorite is one
// flag, and its outbox key (`fav:movie:<tmdb>`) never blocks the rest of the
// title's mirror. An empty answer while several are favorited here is treated
// as an outage, not as "unfavorite everything".
async function mirrorFavorites(db: Db, userId: string, token: string, pending: Set<string>) {
  const [fm, fs] = await Promise.all([getAll('/sync/favorites/movies', token), getAll('/sync/favorites/shows', token)])
  const want = {
    movie: new Set(fm.map(r => Number(((r.movie as AnyRec)?.ids as AnyRec)?.tmdb)).filter(Boolean)),
    show: new Set(fs.map(r => Number(((r.show as AnyRec)?.ids as AnyRec)?.tmdb)).filter(Boolean)),
  }
  const done = { added: 0, removed: 0 }
  for (const type of ['movie', 'show'] as const) {
    const table = type === 'movie' ? 'user_movie_entries' : 'user_tv_entries'
    const join = type === 'movie' ? 'movie:movies(tmdb_id)' : 'tv_series:tv_series(tmdb_id)'
    const { data, error } = await db.from(table).select(`id, is_favorite, ${join}`).eq('user_id', userId)
    if (error) { if (missingColumn(error)) return done; throw error }
    const rows = (data ?? []) as AnyRec[]
    const tmdbOf = (r: AnyRec) => Number(((r.movie ?? r.tv_series) as AnyRec | null)?.tmdb_id)
    const favHere = rows.filter(r => r.is_favorite).length
    const skipRemovals = want[type].size === 0 && favHere > 5
    const on: string[] = []
    const off: string[] = []
    for (const r of rows) {
      const tmdb = tmdbOf(r)
      if (!tmdb || pending.has(`fav:${type}:${tmdb}`)) continue
      const should = want[type].has(tmdb)
      if (should && !r.is_favorite) on.push(String(r.id))
      if (!should && r.is_favorite && !skipRemovals) off.push(String(r.id))
    }
    if (on.length) { const { error: e } = await db.from(table).update({ is_favorite: true }).in('id', on); if (e) throw e }
    if (off.length) { const { error: e } = await db.from(table).update({ is_favorite: false }).in('id', off); if (e) throw e }
    done.added += on.length
    done.removed += off.length
  }
  return done
}

// At the first import favorites are merged, never removed: the app's own go to
// Trakt (before anything is written here), and Trakt's are marked here after.
async function localFavorites(db: Db, userId: string): Promise<{ movie: Set<number>; show: Set<number> }> {
  const out = { movie: new Set<number>(), show: new Set<number>() }
  for (const type of ['movie', 'show'] as const) {
    const table = type === 'movie' ? 'user_movie_entries' : 'user_tv_entries'
    const join = type === 'movie' ? 'movie:movies(tmdb_id)' : 'tv_series:tv_series(tmdb_id)'
    const { data, error } = await db.from(table).select(`id, ${join}`).eq('user_id', userId).eq('is_favorite', true)
    if (error) { if (missingColumn(error)) return out; throw error }
    for (const r of (data ?? []) as AnyRec[]) {
      const tmdb = Number(((r.movie ?? r.tv_series) as AnyRec | null)?.tmdb_id)
      if (tmdb) out[type].add(tmdb)
    }
  }
  return out
}

async function pushFavorites(token: string, mine: { movie: Set<number>; show: Set<number> }, snap: TraktSnapshot, pending: Set<string>) {
  const theirs = new Set(snap.favorites.map(f => `${f.item.type}:${f.item.ids.tmdb}`))
  const send = (type: 'movie' | 'show') => [...mine[type]].filter(id => !theirs.has(`${type}:${id}`) && !pending.has(`fav:${type}:${id}`))
  const movies = send('movie')
  const shows = send('show')
  let sent = 0
  try {
    for (const part of chunk([...movies.map(id => ['movies', id] as const), ...shows.map(id => ['shows', id] as const)], 100)) {
      const body: AnyRec = { movies: [], shows: [] }
      for (const [k, id] of part) (body[k] as AnyRec[]).push(tmdbIds(id))
      await post('/sync/favorites', token, body)
      sent += part.length
    }
  } catch (e) {
    // A free account's favorites allowance (420) must not block the whole import.
    if (e instanceof TraktError && e.status === 420) return { sent, warning: e.message }
    throw e
  }
  return { sent, warning: null as string | null }
}

async function markFavorites(db: Db, userId: string, snap: TraktSnapshot, pending: Set<string>) {
  let marked = 0
  for (const type of ['movie', 'show'] as const) {
    const want = new Set(snap.favorites.filter(f => f.item.type === type && f.item.ids.tmdb).map(f => f.item.ids.tmdb as number))
    if (!want.size) continue
    const table = type === 'movie' ? 'user_movie_entries' : 'user_tv_entries'
    const join = type === 'movie' ? 'movie:movies(tmdb_id)' : 'tv_series:tv_series(tmdb_id)'
    const { data, error } = await db.from(table).select(`id, is_favorite, ${join}`).eq('user_id', userId)
    if (error) { if (missingColumn(error)) return marked; throw error }
    const on = ((data ?? []) as AnyRec[]).filter(r => {
      const tmdb = Number(((r.movie ?? r.tv_series) as AnyRec | null)?.tmdb_id)
      return !r.is_favorite && want.has(tmdb) && !pending.has(`fav:${type}:${tmdb}`)
    }).map(r => String(r.id))
    for (const part of chunk(on, 200)) {
      const { error: e } = await db.from(table).update({ is_favorite: true }).in('id', part)
      if (e) throw e
    }
    marked += on.length
  }
  return marked
}

// ── Rotten Tomatoes / Metacritic / IMDb / Letterboxd via MDBList (phase 6) ────
// GET/POST https://api.mdblist.com/tmdb/{movie|show}[/{id}]?apikey=… (checked
// against the MDBList API blueprint, 30.09.2026): `ratings[]` of
// {source, value, score, votes, url}; `tomatoes` = Tomatometer, `metacritic` =
// Metascore, `imdb` value /10, `letterboxd` value /5. The audience score's
// source name is not in the blueprint — `popcorn` and `tomatoesaudience` are
// both seen in client code, so either is read. The batch POST takes ≤ 200 ids.
const MDBLIST_KEY = () => Deno.env.get('MDBLIST_API_KEY') ?? ''
const RATINGS_TTL_MS = 7 * 24 * 3600_000

interface Scores { rt_critics: number | null; rt_audience: number | null; metacritic: number | null; imdb_rating: number | null; letterboxd_rating: number | null; rt_url: string | null }

function parseScores(item: AnyRec): Scores {
  const list = (Array.isArray(item.ratings) ? item.ratings : []) as AnyRec[]
  const find = (...names: string[]) => list.find(r => names.includes(String(r.source)))
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const tomatoes = find('tomatoes')
  const url = typeof tomatoes?.url === 'string' && tomatoes.url.startsWith('/') ? `https://www.rottentomatoes.com${tomatoes.url}` : null
  return {
    rt_critics: num(tomatoes?.value),
    rt_audience: num(find('popcorn', 'tomatoesaudience', 'audience')?.value),
    metacritic: num(find('metacritic')?.value),
    imdb_rating: num(find('imdb')?.value),
    letterboxd_rating: num(find('letterboxd')?.value),
    rt_url: url,
  }
}

async function mdblist(type: 'movie' | 'show', ids: number[]): Promise<Map<number, Scores>> {
  const out = new Map<number, Scores>()
  if (!MDBLIST_KEY() || ids.length === 0) return out
  for (const part of chunk(ids, 200)) {
    const res = await fetch(`https://api.mdblist.com/tmdb/${type}?apikey=${encodeURIComponent(MDBLIST_KEY())}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: part.map(String) }),
    })
    if (res.status === 429) throw new Error('MDBList daily limit reached — scores refresh tomorrow')
    if (res.status === 401 || res.status === 403) throw new Error('MDBList rejected MDBLIST_API_KEY')
    if (!res.ok) throw new Error(`MDBList ${res.status}`)
    const data = await res.json()
    for (const item of (Array.isArray(data) ? data : [data]) as AnyRec[]) {
      const tmdb = Number((item.ids as AnyRec)?.tmdb)
      if (tmdb) out.set(tmdb, parseScores(item))
    }
  }
  return out
}

/** Writes scores onto the catalogue row (movies / tv_series); newer columns fall back before migration 118. */
async function storeScores(db: Db, type: 'movie' | 'show', scores: Map<number, Scores>, asked: number[]) {
  const table = type === 'movie' ? 'movies' : 'tv_series'
  const now = new Date().toISOString()
  await pool(asked, 5, async tmdb => {
    const s = scores.get(tmdb)
    const patch: AnyRec = { ratings_fetched_at: now, ...(s ?? {}) }
    let { error } = await db.from(table).update(patch).eq('tmdb_id', tmdb)
    if (error && missingColumn(error)) {
      const { imdb_rating: _i, letterboxd_rating: _l, rt_url: _u, ...rest } = patch
      ;({ error } = await db.from(table).update(rest).eq('tmdb_id', tmdb))
    }
    if (error) throw error
  })
}

/** Library titles whose scores are missing or older than a week; at most 200 of each per run. */
async function refreshLibraryScores(db: Db, userId: string) {
  if (!MDBLIST_KEY()) return { skipped: 'no_key' }
  const cutoff = new Date(Date.now() - RATINGS_TTL_MS).toISOString()
  const done: AnyRec = {}
  for (const type of ['movie', 'show'] as const) {
    const entries = type === 'movie' ? 'user_movie_entries' : 'user_tv_entries'
    const join = type === 'movie' ? 'c:movies!inner(tmdb_id, ratings_fetched_at)' : 'c:tv_series!inner(tmdb_id, ratings_fetched_at)'
    const { data, error } = await db.from(entries).select(join).eq('user_id', userId)
    if (error) throw error
    const ids = ((data ?? []) as AnyRec[]).map(r => r.c as AnyRec)
      .filter(c => !c.ratings_fetched_at || String(c.ratings_fetched_at) < cutoff)
      .map(c => Number(c.tmdb_id)).filter(Boolean).slice(0, 200)
    const scores = await mdblist(type, ids)
    await storeScores(db, type, scores, ids)
    done[type] = ids.length
  }
  return done
}

// ── Live reads: Continue watching, my calendar, personal lists ────────────────
const tmdbOfItem = (r: AnyRec, type: string) => Number(((r[type] as AnyRec)?.ids as AnyRec)?.tmdb) || null

async function readPlayback(token: string) {
  const rows = (await get('/sync/playback', token)).data as AnyRec[]
  return (rows ?? []).map(r => {
    const isMovie = r.type === 'movie'
    const ep = (r.episode ?? {}) as AnyRec
    const show = (r.show ?? {}) as AnyRec
    return {
      id: r.id, progress: Number(r.progress) || 0, pausedAt: r.paused_at ?? null,
      type: isMovie ? 'movie' : 'episode',
      tmdb: isMovie ? tmdbOfItem(r, 'movie') : Number((show.ids as AnyRec)?.tmdb) || null,
      title: isMovie ? (r.movie as AnyRec)?.title ?? '' : show.title ?? '',
      season: isMovie ? null : ep.season ?? null, episode: isMovie ? null : ep.number ?? null,
      episodeTitle: isMovie ? null : ep.title ?? null,
    }
  })
}

async function readCalendar(token: string) {
  const start = new Date().toISOString().slice(0, 10)
  const rows = (await get(`/calendars/my/shows/${start}/33`, token)).data as AnyRec[]
  return (rows ?? []).map(r => {
    const ep = (r.episode ?? {}) as AnyRec
    const show = (r.show ?? {}) as AnyRec
    return {
      firstAired: r.first_aired ?? null, season: ep.season ?? null, episode: ep.number ?? null,
      episodeTitle: ep.title ?? null, showTitle: show.title ?? '', tmdb: Number((show.ids as AnyRec)?.tmdb) || null,
    }
  })
}

const LIST_ID = /^[a-z0-9-]{1,120}$/i
const listPath = (id: unknown) => {
  const v = String(id ?? '')
  if (!LIST_ID.test(v)) throw new TraktError(400, 'Invalid list id')
  return `/users/me/lists/${encodeURIComponent(v)}`
}
const mapList = (l: AnyRec) => ({
  id: (l.ids as AnyRec)?.trakt ?? null, slug: (l.ids as AnyRec)?.slug ?? null, name: l.name ?? '',
  description: l.description ?? null, privacy: l.privacy ?? 'private', itemCount: Number(l.item_count) || 0,
  updatedAt: l.updated_at ?? null,
})
function listItemsBody(items: unknown): AnyRec {
  const list = (Array.isArray(items) ? items : []) as AnyRec[]
  const pick = (t: string) => list.filter(i => i.type === t && Number(i.tmdb) > 0).map(i => ({ ids: { tmdb: Number(i.tmdb) } }))
  return { movies: pick('movie'), shows: pick('show') }
}

async function readListItems(db: Db, token: string, id: unknown) {
  const rows = await getAll(`${listPath(id)}/items/movie,show`, token)
  const items = rows.map(r => {
    const type = r.type === 'show' ? 'show' : 'movie'
    const media = (r[type] ?? {}) as AnyRec
    return { listItemId: r.id, rank: r.rank ?? null, type, tmdb: tmdbOfItem(r, type), title: media.title ?? '', year: media.year ?? null, listedAt: r.listed_at ?? null, posterPath: null as string | null }
  })
  // Posters from the catalogue where the title is already known; the app fetches the rest from TMDB.
  for (const type of ['movie', 'show'] as const) {
    const ids = items.filter(i => i.type === type && i.tmdb).map(i => i.tmdb as number)
    if (ids.length === 0) continue
    const { data } = await db.from(type === 'movie' ? 'movies' : 'tv_series').select('tmdb_id, poster_path').in('tmdb_id', ids)
    const byId = new Map(((data ?? []) as AnyRec[]).map(r => [Number(r.tmdb_id), (r.poster_path as string) ?? null]))
    for (const i of items) if (i.type === type && i.tmdb) i.posterPath = byId.get(i.tmdb) ?? null
  }
  return items
}


// ── Follows: franchise / studio / director / actor (migration 119) ───────────
// Once a day per follow (or on "Check now"): TMDB's titles for it; new ones
// become 'new_title' events (and go onto the linked Trakt list), and a new
// YouTube trailer on a recent or upcoming title becomes a 'trailer' event.
// The first check only records the baseline.
async function tmdbQ(path: string, params: Record<string, string> = {}): Promise<AnyRec> {
  const q = new URLSearchParams({ api_key: TMDB_KEY(), language: 'en-US', ...params })
  const res = await fetch(`${TMDB}${path}?${q}`)
  if (res.status === 401) throw new TmdbKeyError()
  if (!res.ok) throw new Error(`TMDB ${res.status}: ${path}`)
  return await res.json()
}

interface FollowTitle { id: number; title: string; poster: string | null; release: string | null }

// What counts as a new film is decided by followRules.ts (generated into the
// <trakt-shared> region): feature films only, and new by their OWN release
// date — never because TMDB listed an old film late (a late cameo credit, a
// keyword tagged onto an old film, a studio window shifting). That was the
// root cause of long-released films (Avengers: Endgame) showing as "new".
async function followTitles(kind: string, id: number): Promise<{ titles: FollowTitle[]; rawIds: number[] }> {
  const map = (r: AnyRec): FollowTitle => ({ id: Number(r.id), title: String(r.title ?? r.name ?? ''), poster: (r.poster_path as string) ?? null, release: (r.release_date as string) || null })
  let rows: AnyRec[]
  if (kind === 'collection') rows = ((await tmdbQ(`/collection/${id}`)).parts ?? []) as AnyRec[]
  else if (kind === 'company' || kind === 'keyword') {
    const by = kind === 'company' ? 'with_companies' : 'with_keywords'
    // Newest first, five pages (100 films) — enough to catch every new title
    // and trailer; the smart list itself reads the full list client-side.
    const pages = await Promise.all([1, 2, 3, 4, 5].map(page => tmdbQ('/discover/movie', {
      [by]: String(id), sort_by: 'primary_release_date.desc', page: String(page),
      without_genres: FOLLOW_NON_FEATURE_GENRES.join(','), include_adult: 'false', include_video: 'false',
      'primary_release_date.lte': new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10),
    })))
    rows = pages.flatMap(p => (p.results ?? []) as AnyRec[])
  } else {
    const credits = await tmdbQ(`/person/${id}/movie_credits`)
    rows = (kind === 'director' ? credits.crew ?? [] : credits.cast ?? []) as AnyRec[]
  }
  const seen = new Map<number, FollowTitle>()
  for (const r of rows) if (isFollowFeature(r as FollowCandidate, kind)) seen.set(Number(r.id), map(r))
  return { titles: [...seen.values()], rawIds: [...new Set(rows.map(r => Number(r.id)).filter(Number.isFinite))] }
}

async function trailerKeys(movieId: number): Promise<string[]> {
  const v = await tmdbQ(`/movie/${movieId}/videos`)
  return ((v.results ?? []) as AnyRec[]).filter(x => isFollowTrailer(x as { site?: string; type?: string; official?: boolean; key?: string })).map(x => String(x.key))
}

async function checkFollows(db: Db, userId: string, token: string | null, force: boolean) {
  if (!TMDB_KEY()) return { skipped: 'no_tmdb_key' }
  const { data, error } = await db.from('media_follows').select('*').eq('user_id', userId)
  if (error) { if (['42P01', 'PGRST205'].includes(String(error.code))) return { skipped: 'no_table' }; throw error }
  const due = ((data ?? []) as AnyRec[])
    .filter(f => force || !f.last_checked_at || Date.now() - Date.parse(String(f.last_checked_at)) > 20 * 3600_000)
    // Never-checked follows first, so a new follow always gets its baseline.
    .sort((x, y) => String(x.last_checked_at ?? '').localeCompare(String(y.last_checked_at ?? '')))
  const out = { checked: 0, newTitles: 0, trailers: 0, cleared: 0, listAdded: 0, listWaiting: 0 }
  const today = new Date().toISOString().slice(0, 10)
  for (const f of due.slice(0, 15)) {
    const { titles, rawIds } = await followTitles(String(f.kind), Number(f.tmdb_id))
    const known = new Set<number>((f.known_ids as number[]) ?? [])
    const baseline = known.size === 0 && !f.last_checked_at
    // Films TMDB lists for the first time. They go onto the linked list
    // (it holds the follow's whole filmography), but only the ones new by
    // their own date — and not a short or a cancelled film — become events.
    const fresh = baseline ? [] : titles.filter(t => !known.has(t.id))
    const events: AnyRec[] = []
    for (const t of fresh.filter(t => isNewByDate(t.release, today)).slice(0, 20)) {
      const d = await tmdbQ(`/movie/${t.id}`).catch(() => null)
      if (followDetailsReject(d as { runtime?: number; status?: string } | null)) continue
      events.push({ user_id: userId, follow_id: f.id, kind: 'new_title', tmdb_id: t.id, title: t.title, poster_path: t.poster, release_date: t.release })
    }
    const newTitleCount = events.length
    const keysBefore = new Set<string>((f.trailer_keys as string[]) ?? [])
    // Trailers only for films that are themselves new: coming, or out in the last 30 days.
    const watch = titles.filter(t => isNewByDate(t.release, today))
      .sort((x, y) => String(y.release ?? '9999').localeCompare(String(x.release ?? '9999'))).slice(0, 8)
    const keys = new Set(keysBefore)
    for (const t of watch) {
      for (const k of await trailerKeys(t.id)) {
        if (keys.has(k)) continue
        keys.add(k)
        if (!baseline) events.push({ user_id: userId, follow_id: f.id, kind: 'trailer', tmdb_id: t.id, title: t.title, poster_path: t.poster, release_date: t.release, video_key: k })
      }
    }
    if (events.length) { const { error: e } = await db.from('media_follow_events').insert(events); if (e) throw e }
    // Earlier events the rule now rejects leave What's new: a title no longer
    // listed as a feature film (a documentary, a cameo, a stub), or one that
    // was not new on the day it was reported. Skipped when TMDB listed nothing,
    // so a bad answer never empties the feed.
    if (!baseline && titles.length) {
      const keep = new Set(titles.map(t => t.id))
      const { data: old, error: oe } = await db.from('media_follow_events').select('id, tmdb_id, release_date, created_at').eq('user_id', userId).eq('follow_id', f.id)
      if (oe) throw oe
      const drop = ((old ?? []) as AnyRec[])
        .filter(e => !keep.has(Number(e.tmdb_id)) || !isShowableFollowEvent({ release_date: (e.release_date as string) ?? null, created_at: String(e.created_at) }))
        .map(e => String(e.id))
      if (drop.length) {
        const { error: de } = await db.from('media_follow_events').delete().in('id', drop)
        if (de) throw de
        out.cleared += drop.length
      }
    }
    const list = await fillFollowList(f, fresh, titles, token, today)
    const checkedAt = new Date().toISOString()
    // Every id TMDB listed, kept or not, so a film reclassified later is never "new".
    const fields: AnyRec = { known_ids: [...new Set([...known, ...rawIds])], trailer_keys: [...keys], last_checked_at: checkedAt }
    // What the linked list has not taken yet waits for the next check (136).
    const listFields = { pending_list_ids: list.pending, list_error: list.pending.length ? list.error : null, list_error_at: list.pending.length ? checkedAt : null }
    let { error: ue } = await db.from('media_follows').update({ ...fields, ...listFields }).eq('id', f.id)
    if (ue && missingColumn(ue)) ({ error: ue } = await db.from('media_follows').update(fields).eq('id', f.id)) // before 136
    if (ue) throw ue
    out.checked++; out.newTitles += newTitleCount; out.trailers += events.length - newTitleCount
    out.listAdded += list.added; out.listWaiting += list.pending.length
  }
  return out
}

/**
 * Sends a follow's new films — and the ones still waiting — to its linked
 * Trakt list (it holds the follow's whole filmography). A film is done only
 * when Trakt took it: a refused or failed add (Trakt's 420 account limit, an
 * error, no Trakt sign-in at hand) leaves it in `pending` with the reason,
 * and the next check sends it again (followRules.ts).
 */
async function fillFollowList(f: AnyRec, fresh: FollowTitle[], titles: FollowTitle[], token: string | null, today: string) {
  const listId = Number(f.trakt_list_id) || null
  // Not on Trakt yet: "Put on Trakt" fills the whole list when it is made.
  if (!listId) return { added: 0, pending: [] as number[], error: null as string | null }
  const before = Array.isArray(f.pending_list_ids) ? (f.pending_list_ids as unknown[]).map(Number) : []
  const ids = followListToSend(before, fresh.map(t => t.id), titles.length ? new Set(titles.map(t => t.id)) : null)
  if (!ids.length) return { added: 0, pending: [] as number[], error: null as string | null }
  const stillNew = new Set(titles.filter(t => isNewByDate(t.release, today)).map(t => t.id))
  const attempt: FollowListAttempt = { ids, accepted: 0, notFound: [] }
  let error: string | null = null
  if (!token) error = 'Trakt was not signed in at the check'
  else {
    for (const part of chunk(ids, 100)) {
      try {
        const res = await post(`/users/me/lists/${listId}/items`, token, { movies: part.map(id => ({ ids: { tmdb: id } })) })
        attempt.accepted += part.length
        const missing = (((res.not_found as AnyRec | undefined)?.movies ?? []) as AnyRec[])
        attempt.notFound.push(...missing.map(m => Number((m.ids as AnyRec | undefined)?.tmdb)).filter(n => Number.isSafeInteger(n) && n > 0))
      } catch (e) {
        error = e instanceof TraktError && e.status === 404
          ? 'Its Trakt list was not found — put it on Trakt again from the Lists page'
          : e instanceof Error ? e.message : String(e)
        break
      }
    }
  }
  const pending = followListPending(attempt, stillNew)
  if (!error && pending.length) error = `Trakt doesn’t know ${pending.length === 1 ? 'this new film' : 'these new films'} yet`
  return { added: Math.max(0, attempt.accepted - attempt.notFound.length), pending, error }
}

// ── The two runs ─────────────────────────────────────────────────────────────
const summary = ({ sentKeys: _k, ...rest }: Awaited<ReturnType<typeof drainOutbox>>) => rest

async function pendingKeys(db: Db, userId: string, sentKeys: string[]): Promise<Set<string>> {
  const { data: waiting, error } = await db.from('trakt_outbox').select('item_key').eq('user_id', userId)
  if (error) throw error
  // Items just sent count as pending for this run too: Trakt may not show a
  // write in the same second, and the mirror must never undo it.
  return new Set<string>([...((waiting ?? []) as AnyRec[]).map(r => String(r.item_key)), ...sentKeys])
}

async function runSync(db: Db, userId: string, token: string, username: string | null, opts: { full?: boolean; force?: boolean }) {
  const deadline = Date.now() + 90_000
  const drained = await drainOutbox(db, userId, token, deadline)
  const lastActivities = (await get('/sync/last_activities', token)).data as AnyRec
  const { data: state } = await db.from('trakt_sync_state').select('last_activities').eq('user_id', userId).maybeSingle()
  const prev = ((state as AnyRec | null)?.last_activities ?? null) as AnyRec | null
  // Scores never fail a sync: MDBList being down or out of quota is only noted.
  const scores = await refreshLibraryScores(db, userId).catch(e => ({ error: e instanceof Error ? e.message : String(e) }))
  const follows = await checkFollows(db, userId, token, false).catch(e => ({ error: e instanceof Error ? e.message : String(e) }))
  const change = lastActivitiesChange(prev, lastActivities)
  // Notes (136): compared in full when they changed on Trakt, on Sync now, or never yet.
  const ns = await notesState(db, userId)
  const notesDue = ns.ready && (!!opts.full || change.reset || !ns.syncedAt || notesActivity(prev) !== notesActivity(lastActivities))
  if (!opts.full && !change.changed) {
    const notes = notesDue ? await runNotes(db, userId, token, await pendingKeys(db, userId, drained.sentKeys)) : null
    return { pulled: false, drained: summary(drained), lastActivities, scores, follows, notes }
  }
  // A watched-progress reset on Trakt re-checks every show, like Sync now.
  const full = !!opts.full || change.reset

  const snap = await snapshot(token, username) as unknown as TraktSnapshot
  const local = await loadLocal(db, userId)
  const pending = await pendingKeys(db, userId, drained.sentKeys)
  // A full sync (Sync now) re-checks Completed vs Watching for every show with
  // episodes; the timed one only for shows whose episodes changed.
  const needInfo = full ? showsNeedingInfo(snap, local.lib) : showsNeedingInfoForSync(snap, local.lib, pending)
  const { info, details } = await showInfo(needInfo)
  let plan = buildSyncPlan(snap, local.lib, info, pending)
  let heldBack = 0
  // Held back, the removals AND the show statuses they would change wait.
  if (!opts.force && removalsNeedConfirm(plan, local.lib)) { heldBack = removalCount(plan); plan = withoutRemovals(plan) }
  const { done: applied, unadded } = await applyWrites(db, userId, local, plan, details)
  await backfillIds(db, plan.ids)
  const unmatched = await recordUnmatched(db, userId, snap, unadded)
  const favChanged = full || (prev?.favorites as AnyRec | undefined)?.updated_at !== (lastActivities?.favorites as AnyRec | undefined)?.updated_at
  const favorites = favChanged ? await mirrorFavorites(db, userId, token, pending) : null
  // A title that just came in from Trakt may already have a note there.
  const added = plan.movies.some(m => !local.movieEntry.has(m.tmdbId)) || plan.shows.some(s => !local.showEntry.has(s.tmdbId))
  const notes = notesDue || (ns.ready && added) ? await runNotes(db, userId, token, pending) : null
  return { pulled: true, drained: summary(drained), applied, favorites, heldBack, kept: plan.kept.length, unmatched, lastActivities, scores, follows, notes }
}

/**
 * The first import. Order matters:
 *   1. the outbox is sent (a change waiting there must not be pushed twice);
 *   2. Trakt and the library are read, and items still waiting are left out;
 *   3. the app-only facts (and favorites) go to Trakt FIRST — if Trakt refuses
 *      anything, the run stops before writing here and is not marked done, so
 *      the sync (which treats Trakt as the truth) never starts on half a push;
 *   4. Trakt → library, Trakt's favorites marked here, ids, unmatched;
 *   5. notes (136), both ways: three-way, so no note is lost even when this
 *      step is cut short — the next sync compares them again.
 * Only a run that got through 1–4 stamps imported_at (by the caller).
 */
async function runImport(db: Db, userId: string, token: string, username: string | null) {
  // Without TMDB the import can't add new titles or tell a finished show from one in progress.
  if (!TMDB_KEY()) throw new Error('TMDB_API_KEY is not set on the trakt-api function (use the same TMDB key as the app)')
  const drained = await drainOutbox(db, userId, token, Date.now() + 45_000)
  const snap = await snapshot(token, username) as unknown as TraktSnapshot
  const local = await loadLocal(db, userId)
  const pending = await pendingKeys(db, userId, drained.sentKeys)
  const { info, details } = await showInfo(showsNeedingInfo(snap, local.lib))
  const plan = buildImportPlan(snap, local.lib, info, pending)
  const mine = await localFavorites(db, userId)

  const sent = pushCount(plan.push)
  const tally = await push(token, plan.push)
  const fav = await pushFavorites(token, mine, snap, pending)

  const { done: applied, unadded } = await applyWrites(db, userId, local, plan, details)
  const favoritesMarked = await markFavorites(db, userId, snap, pending)
  await backfillIds(db, plan.ids)
  const unmatched = await recordUnmatched(db, userId, snap, unadded)
  // Notes (136): the app's notes Trakt lacks go to Trakt, Trakt's come in —
  // after the library is written, so a note can land on a title just added.
  // A note refused (note limit) or not sent yet never fails the import.
  const notes = (await notesState(db, userId)).ready ? await runNotes(db, userId, token, pending) : null
  const lastActivities = (await get('/sync/last_activities', token)).data as AnyRec
  return {
    applied, sent, tally, unmatched, drained: summary(drained),
    favorites: { sent: fav.sent, marked: favoritesMarked, warning: fav.warning }, notes, lastActivities,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const url = Deno.env.get('SUPABASE_URL')!
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const supabase = createClient(url, key)

  let body: { action?: Action; code?: string; redirectUri?: string; state?: string; full?: boolean; force?: boolean
    mediaType?: string; tmdbId?: number; listId?: string | number; name?: string; description?: string; items?: unknown
    rank?: unknown; id?: unknown } = {}
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

  // Scores for one title (MDBList — needs no Trakt connection). Stored on the
  // catalogue row when the title is in the library; returned either way.
  if (action === 'ratings') {
    try {
      const type = body.mediaType === 'tv' || body.mediaType === 'show' ? 'show' : 'movie'
      const tmdb = Number(body.tmdbId)
      if (!Number.isInteger(tmdb) || tmdb <= 0) return json({ error: 'tmdbId required' }, 400)
      if (!MDBLIST_KEY()) return json({ error: 'not_configured' }, 200)
      const scores = await mdblist(type, [tmdb])
      await storeScores(createClient(url, key, { global: { headers: { 'x-trakt-sync': '1' } } }), type, scores, [tmdb])
      return json({ scores: scores.get(tmdb) ?? null })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // "Check now" for follows — needs TMDB, not Trakt (a linked list is only
  // filled when a valid Trakt token is on file).
  if (action === 'follows_check') {
    try {
      const { data: t } = await supabase.from('trakt_tokens').select('access_token, expires_at').eq('user_id', userId).maybeSingle()
      const tokenOk = t && new Date(String((t as AnyRec).expires_at)).getTime() > Date.now() + 60_000 ? String((t as AnyRec).access_token) : null
      return json({ result: await checkFollows(supabase, userId, tokenOk, true) })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

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
        // The first import has finished (sync runs only after it); before migration 124, last_full_at.
        imported: 'imported_at' in st ? !!st.imported_at : !!st.last_full_at,
        pending: count ?? 0,
        syncing: !!st.sync_started_at && Date.now() - new Date(String(st.sync_started_at)).getTime() < 5 * 60_000,
      })
    }

    if (action === 'disconnect') {
      if (tok) {
        // Revoke on Trakt first; a failed revoke still removes our copy.
        await oauth('/oauth/revoke', { token: tok.access_token, client_id: CLIENT_ID(), client_secret: CLIENT_SECRET() }).catch(() => null)
        // Note links belong to this Trakt account (136): a new connection —
        // maybe another account — compares every note again. Done before the
        // token goes, so a failure here can simply be retried.
        for (const table of Object.values(NOTE_TABLE)) {
          const cleared = await supabase.from(table).update({ trakt_note_id: null, trakt_note_text: null }).eq('user_id', userId).not('trakt_note_id', 'is', null)
          if (cleared.error && !missingColumn(cleared.error)) throw cleared.error
        }
        await supabase.from('trakt_sync_state').update({ notes_synced_at: null }).eq('user_id', userId) // fails harmlessly before 136
        const { error } = await supabase.from('trakt_tokens').delete().eq('user_id', userId)
        if (error) throw error
        // Changes queued for this connection would be stale on the next one.
        await supabase.from('trakt_outbox').delete().eq('user_id', userId)
        // A new connection (maybe another Trakt account) starts with an import again.
        await supabase.from('trakt_sync_state').update({ imported_at: null, last_activities: null }).eq('user_id', userId)
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
      const snap = await snapshot(accessToken, username)
      // The preview's notes (the sync reads them only when they changed).
      const notes = await readTraktNotes(accessToken).catch(e => {
        snap.warnings.push(`Notes could not be read: ${noteFailureMessage(e)}.`)
        return null
      })
      return json({ ...snap, notes })
    }

    if (action === 'playback') return json({ items: await readPlayback(accessToken) })
    // DELETE /sync/playback/{id} (API blueprint, "Remove a playback item"):
    // 204 = removed; a 404 means it is already gone, which is the same result.
    if (action === 'playback_remove') {
      const id = Number(body.id)
      if (!Number.isSafeInteger(id) || id <= 0) return json({ error: 'id required' }, 400)
      await del(`/sync/playback/${id}`, accessToken)
      return json({ ok: true })
    }
    if (action === 'calendar') return json({ items: await readCalendar(accessToken) })
    if (action === 'lists') return json({ lists: ((await get('/users/me/lists', accessToken)).data as AnyRec[] ?? []).map(mapList) })
    if (action === 'list_items') return json({ items: await readListItems(supabase, accessToken, body.listId) })
    if (action === 'list_create') {
      const name = String(body.name ?? '').trim().slice(0, 100)
      if (!name) return json({ error: 'name required' }, 400)
      const l = await post('/users/me/lists', accessToken, {
        name, description: String(body.description ?? '').slice(0, 500) || undefined, privacy: 'private', sort_by: 'rank', sort_how: 'asc',
      })
      return json({ list: mapList(l) })
    }
    if (action === 'list_delete') { await del(listPath(body.listId), accessToken); return json({ deleted: true }) }
    // POST /users/{id}/lists/{list_id}/items/reorder with every list item id in
    // the new order (API blueprint, "Reorder List Items"). Used by the Queue.
    if (action === 'list_reorder') {
      const rank = (Array.isArray(body.rank) ? body.rank : []).map(Number).filter(n => Number.isInteger(n) && n > 0)
      if (!rank.length) return json({ error: 'rank required' }, 400)
      const res = await post(`${listPath(body.listId)}/items/reorder`, accessToken, { rank })
      return json({ updated: (res as AnyRec)?.updated ?? null, skipped: (res as AnyRec)?.skipped_ids ?? [] })
    }
    if (action === 'list_add' || action === 'list_remove') {
      const res = await post(`${listPath(body.listId)}/items${action === 'list_remove' ? '/remove' : ''}`, accessToken, listItemsBody(body.items))
      return json({ result: res, notFound: notFoundCount(res) })
    }

    if (action === 'import' || action === 'sync') {
      // Library writes carry x-trakt-sync so the outbox triggers skip them.
      const db = createClient(url, key, { global: { headers: { 'x-trakt-sync': '1' } } })
      // The sync mirrors Trakt as the truth: before the first import it would
      // wipe ratings, dropped states and everything only the app holds.
      if (action === 'sync' && !(await hasImported(db, userId))) {
        if (fromCron) return json({ skipped: 'not_imported' })
        await db.from('trakt_sync_state').update({ last_error: NOT_IMPORTED }).eq('user_id', userId)
        return json({ error: NOT_IMPORTED, code: 'not_imported' }, 409)
      }
      if (!(await takeLock(db, userId))) return json({ busy: true })
      const now = new Date().toISOString()
      try {
        if (action === 'import') {
          const r = await runImport(db, userId, accessToken, username)
          const notes = notesResult(r.drained.notes, r.notes)
          const result = { kind: 'import', at: now, applied: r.applied, sent: r.sent, tally: r.tally, unmatched: r.unmatched, drained: r.drained, favorites: r.favorites, notes }
          const problems = [r.favorites.warning && `Favorites not all sent: ${r.favorites.warning}`, notes?.error && `Notes: ${notes.error}`].filter(Boolean)
          await stamp(db, userId, {
            last_sync_at: now, last_full_at: now, imported_at: now, last_activities: r.lastActivities,
            ...(r.notes?.complete ? { notes_synced_at: now } : {}),
            last_error: problems.length ? problems.join(' · ') : null, last_result: result,
          })
          return json(result)
        }
        const r = await runSync(db, userId, accessToken, username, { full: body.full, force: body.force })
        const notes = notesResult(r.drained.notes, r.notes)
        const result = { kind: 'sync', at: now, pulled: r.pulled, drained: r.drained, applied: r.applied ?? null, heldBack: r.heldBack ?? 0, kept: r.kept ?? 0, unmatched: r.unmatched ?? null, notes }
        const problems = [r.drained.error && `Sending to Trakt failed: ${r.drained.error}`, notes?.error && `Notes: ${notes.error}`].filter(Boolean)
        await stamp(db, userId, {
          last_sync_at: now, ...(body.full ? { last_full_at: now } : {}), last_activities: r.lastActivities,
          ...(r.notes?.complete ? { notes_synced_at: now } : {}),
          last_error: problems.length ? problems.join(' · ') : null, last_result: result,
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
    // `detail` is what the app's "Copy details" puts in the report: the Trakt
    // path, its status and the first 300 characters it answered (never a token).
    const detail = err instanceof TraktError ? err.detail ?? null : { stack: err instanceof Error ? String(err.stack ?? '').split('\n').slice(0, 4).join(' | ') : null }
    return json({ error: message, action, detail }, status >= 400 && status < 600 ? status : 500)
  }
})
