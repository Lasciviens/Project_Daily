import type { TraktSnapshot } from './traktTypes'
import { isUnknownWatchedAt } from './traktDates'

// Every watch keeps its own date (migration 149, docs/features/media.md):
// Trakt's per-play history (GET /sync/history, one row per play with its own
// id) ⇄ media_watches (one row per watch here). Pure and import-free
// (scripts/verify-trakt-watch-plan.cjs), shared into the trakt-api edge
// function by scripts/sync-trakt-shared.mjs.
//
// Trakt → app: an item Trakt's watched summary lists is matched play by play
// — a watch linked to a Trakt play (trakt_history_id) keeps it; the rest pair
// up by the same time (to the second), then in date order (Trakt's date
// wins); extra plays are added, extra watches removed. Placeholders (source
// 'backfill': the one kept date, copied once per play) are simply replaced.
// Items with a change waiting in the outbox, and items Trakt's summary no
// longer lists (the summary plan removes those, with its held-back guard),
// are left alone. An item whose history came back empty is left alone too.
//
// App → Trakt: a removed watch removes ONE play — by its Trakt id, else the
// play at the same time, else the play nearest in time that no other watch
// here accounts for (playToRemove).

export type WatchSource = 'app' | 'trakt' | 'backfill'
export interface LocalWatch { id: string; watchedAt: string | null; historyId: number | null; source: WatchSource; createdAt?: string | null }
/** One play on Trakt: its history id and when (the epoch = unknown date). */
export interface TraktPlay { historyId: number; watchedAt: string }
export interface KeyedPlay extends TraktPlay { key: string; kind: 'movie' | 'episode'; tmdbId: number; season?: number; episode?: number }

export interface WatchUpdate { id: string; watchedAt: string | null; historyId: number }
export interface WatchInsert { key: string; watchedAt: string | null; historyId: number }
export interface ItemMatch { updates: WatchUpdate[]; inserts: { watchedAt: string | null; historyId: number }[]; removes: string[] }
export interface WatchPlan {
  updates: WatchUpdate[]
  inserts: WatchInsert[]
  removes: string[]
  /** Items whose history came back without plays (left alone this run). */
  skipped: string[]
}

export const watchKey = {
  movie: (tmdb: number) => `movie:${tmdb}`,
  episode: (tmdb: number, season: number, episode: number) => `ep:${tmdb}:${season}:${episode}`,
}

const UNKNOWN = -1
/** A time to the second; every unknown date (NULL, the epoch) is the same. */
function secondOf(iso: string | null | undefined): number {
  if (!iso || isUnknownWatchedAt(iso)) return UNKNOWN
  const t = Date.parse(iso)
  return Number.isFinite(t) ? Math.floor(t / 1000) : UNKNOWN
}
export const sameSecond = (a: string | null | undefined, b: string | null | undefined) => secondOf(a) === secondOf(b)

/** How a Trakt play's date is stored here: a movie's unknown date is NULL, an episode's the epoch. */
export function storedWatchedAt(kind: 'movie' | 'episode', iso: string): string | null {
  if (isUnknownWatchedAt(iso)) return kind === 'movie' ? null : '1970-01-01T00:00:00.000Z'
  return new Date(Math.floor(Date.parse(iso) / 1000) * 1000).toISOString()
}

const isRec = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

/**
 * GET /sync/history rows → plays keyed like the outbox (movie:<tmdb>,
 * ep:<show tmdb>:<season>:<episode>). Row shape (API blueprint "Get watched
 * history" and trakt-api's contract): {id (64-bit), watched_at, action, type:
 * 'movie' | 'episode', movie | episode {season, number} + show}. A row
 * without a TMDB id, a valid id or date is counted, never guessed.
 */
export function parseHistory(rows: unknown): { plays: KeyedPlay[]; unreadable: number } {
  const plays: KeyedPlay[] = []
  let unreadable = 0
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isRec(r)) { unreadable++; continue }
    const id = r.id
    const at = r.watched_at
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0 || typeof at !== 'string' || !Number.isFinite(Date.parse(at))) { unreadable++; continue }
    const tmdbOf = (o: unknown) => (isRec(o) && isRec(o.ids) ? Number(o.ids.tmdb) || 0 : 0)
    if (r.type === 'movie') {
      const tmdb = tmdbOf(r.movie)
      if (!tmdb) { unreadable++; continue }
      plays.push({ key: watchKey.movie(tmdb), kind: 'movie', tmdbId: tmdb, historyId: id, watchedAt: at })
    } else if (r.type === 'episode') {
      const tmdb = tmdbOf(r.show)
      const ep = isRec(r.episode) ? r.episode : null
      const season = Number(ep?.season)
      const episode = Number(ep?.number)
      if (!tmdb || !Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 0) { unreadable++; continue }
      plays.push({ key: watchKey.episode(tmdb, season, episode), kind: 'episode', tmdbId: tmdb, season, episode, historyId: id, watchedAt: at })
    } else unreadable++
  }
  return { plays, unreadable }
}

/** Plays per item key. */
export function playsByKey(plays: KeyedPlay[]): Map<string, TraktPlay[]> {
  const out = new Map<string, TraktPlay[]>()
  for (const p of plays) {
    const list = out.get(p.key) ?? []
    if (!list.some(x => x.historyId === p.historyId)) list.push({ historyId: p.historyId, watchedAt: p.watchedAt })
    out.set(p.key, list)
  }
  return out
}

const byTime = (a: { watchedAt: string | null }, b: { watchedAt: string | null }) => secondOf(a.watchedAt) - secondOf(b.watchedAt)
const SOURCE_RANK: Record<WatchSource, number> = { app: 0, backfill: 1, trakt: 2 }

/** One item: the watches here made to match Trakt's plays of it. */
export function matchItem(kind: 'movie' | 'episode', local: LocalWatch[], plays: TraktPlay[]): ItemMatch {
  const updates: WatchUpdate[] = []
  const inserts: ItemMatch['inserts'] = []
  const removes: string[] = []
  const byId = new Map(plays.map(p => [p.historyId, p]))
  const used = new Set<number>()
  const pool: LocalWatch[] = []
  const link = (w: LocalWatch, p: TraktPlay) => {
    used.add(p.historyId)
    const at = storedWatchedAt(kind, p.watchedAt)
    if (w.historyId !== p.historyId || w.source !== 'trakt' || !sameSecond(w.watchedAt, at) || (w.watchedAt === null) !== (at === null)) {
      updates.push({ id: w.id, watchedAt: at, historyId: p.historyId })
    }
  }

  // 1. A watch already linked to a play Trakt still has keeps it.
  for (const w of local) {
    const p = w.historyId != null ? byId.get(w.historyId) : undefined
    if (p && !used.has(p.historyId)) link(w, p)
    else pool.push(w)
  }
  let rest = plays.filter(p => !used.has(p.historyId)).sort(byTime)
  // 2. Same time: added here and sent, or a placeholder that happens to match.
  pool.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || byTime(a, b))
  const left: LocalWatch[] = []
  for (const w of pool) {
    const p = rest.find(x => sameSecond(x.watchedAt, w.watchedAt))
    if (p) { link(w, p); rest = rest.filter(x => x !== p) } else left.push(w)
  }
  // 3. The rest in date order: Trakt's date wins.
  left.sort(byTime)
  const n = Math.min(left.length, rest.length)
  for (let i = 0; i < n; i++) link(left[i], rest[i])
  for (const p of rest.slice(n)) inserts.push({ watchedAt: storedWatchedAt(kind, p.watchedAt), historyId: p.historyId })
  for (const w of left.slice(n)) removes.push(w.id)
  return { updates, inserts, removes }
}

export interface WatchPlanInput {
  /** Items Trakt's watched summary lists (only these are matched). */
  watched: Set<string>
  /** The watches here, per item key. */
  local: Map<string, LocalWatch[]>
  /** Trakt's plays per item key, for the items whose history was read. */
  plays: Map<string, TraktPlay[]>
  /** Item keys whose history was read this run. */
  read: Set<string>
  /** Item keys with a change still waiting in the outbox (or just sent). */
  pending: Set<string>
}

export function buildWatchPlan(input: WatchPlanInput): WatchPlan {
  const plan: WatchPlan = { updates: [], inserts: [], removes: [], skipped: [] }
  for (const key of [...input.watched].sort()) {
    if (input.pending.has(key) || !input.read.has(key)) continue
    const plays = input.plays.get(key) ?? []
    if (!plays.length) { plan.skipped.push(key); continue }
    const kind = key.startsWith('movie:') ? 'movie' : 'episode'
    const m = matchItem(kind, input.local.get(key) ?? [], plays)
    plan.updates.push(...m.updates)
    plan.inserts.push(...m.inserts.map(i => ({ ...i, key })))
    plan.removes.push(...m.removes)
  }
  return plan
}

export const watchPlanSize = (p: WatchPlan) => p.updates.length + p.inserts.length + p.removes.length

/** Up to this many titles are read one by one; more, and the whole history is read at once. */
export const HISTORY_TARGET_MAX = 25

export interface HistoryTargets {
  /** TMDB id → Trakt id of the shows/movies whose history to read. */
  shows: Map<number, number>
  movies: Map<number, number>
  /** A title that needs reading has no Trakt id: only a full read can cover it. */
  needsFull: boolean
}

/**
 * The titles whose plays here differ from Trakt's watched summary (another
 * count, another latest date, or a watch not linked to a play yet) — their
 * history is read one by one when there are few.
 */
export function historyTargets(snap: TraktSnapshot, local: Map<string, LocalWatch[]>, pending: Set<string>): HistoryTargets {
  const out: HistoryTargets = { shows: new Map(), movies: new Map(), needsFull: false }
  const differs = (key: string, plays: number, at: string | null) => {
    if (pending.has(key)) return false
    const mine = local.get(key) ?? []
    if (mine.length !== plays || mine.some(w => w.historyId == null)) return true
    const latest = mine.reduce<string | null>((x, w) => (secondOf(w.watchedAt) > secondOf(x) ? w.watchedAt : x), null)
    return !!at && !sameSecond(latest, at)
  }
  const want = (map: Map<number, number>, tmdb: number, trakt: number) => {
    if (trakt > 0) map.set(tmdb, trakt)
    else out.needsFull = true
  }
  for (const m of snap.watchedMovies) {
    const tmdb = m.item.ids.tmdb
    if (tmdb && differs(watchKey.movie(tmdb), m.plays, m.lastWatchedAt)) want(out.movies, tmdb, m.item.ids.trakt)
  }
  for (const s of snap.watchedShows) {
    const tmdb = s.item.ids.tmdb
    if (!tmdb) continue
    if (s.episodes.some(([season, episode, plays, at]) => differs(watchKey.episode(tmdb, season, episode), plays, at))) want(out.shows, tmdb, s.item.ids.trakt)
  }
  return out
}

/** Every item Trakt's watched summary lists, by key. */
export function summaryKeys(snap: TraktSnapshot): Set<string> {
  const out = new Set<string>()
  for (const m of snap.watchedMovies) if (m.item.ids.tmdb) out.add(watchKey.movie(m.item.ids.tmdb))
  for (const s of snap.watchedShows) {
    const tmdb = s.item.ids.tmdb
    if (tmdb) for (const [season, episode] of s.episodes) out.add(watchKey.episode(tmdb, season, episode))
  }
  return out
}

/**
 * The Trakt play a removed watch was: its own id when Trakt still has it;
 * else the play at the same time, else the one nearest in time — among the
 * plays no remaining watch here accounts for (by id, or by the same time).
 * null = nothing left to remove.
 */
export function playToRemove(removed: { historyId: number | null; watchedAt: string | null }, plays: TraktPlay[], keep: { historyId: number | null; watchedAt: string | null }[]): number | null {
  if (removed.historyId != null) return plays.some(p => p.historyId === removed.historyId) ? removed.historyId : null
  const keptIds = new Set(keep.filter(k => k.historyId != null).map(k => k.historyId!))
  let open = plays.filter(p => !keptIds.has(p.historyId))
  for (const k of keep) {
    if (k.historyId != null) continue
    const same = open.find(p => sameSecond(p.watchedAt, k.watchedAt))
    if (same) open = open.filter(p => p !== same)
  }
  if (!open.length) return null
  const t = secondOf(removed.watchedAt)
  const exact = open.find(p => secondOf(p.watchedAt) === t)
  if (exact) return exact.historyId
  const dist = (p: TraktPlay) => Math.abs(Math.max(0, secondOf(p.watchedAt)) - Math.max(0, t))
  return open.reduce((best, p) => (dist(p) < dist(best) ? p : best)).historyId
}

/**
 * Outbox rows that cancel out before anything is sent: a watch added and
 * removed again (or re-dated) while its add still waits — both rows go, so
 * Trakt never gets a play only to lose it again. Rows in send order.
 */
export function cancelledOutboxRows(rows: { id: string; op: string; payload?: Record<string, unknown> | null }[]): string[] {
  const out: string[] = []
  const adds = new Map<string, string>()
  for (const r of rows) {
    const watch = typeof r.payload?.watch_id === 'string' ? r.payload.watch_id : null
    if (!watch) continue
    if (r.op === 'history_add') adds.set(watch, r.id)
    else if (r.op === 'history_remove_play' && adds.has(watch)) {
      out.push(adds.get(watch)!, r.id)
      adds.delete(watch)
    }
  }
  return out
}
