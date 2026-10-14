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
// 'backfill': the one kept date, copied once per play) are simply replaced
// and become 'trakt'; a watch added in the app stays 'app' (a rewatch round
// counts it by when it was added). Items with a change waiting in the outbox,
// and items Trakt's summary no longer lists (the summary plan removes those,
// with its held-back guard), are left alone — except an item whose only
// waiting change is a single-play remove waiting for the ids: its watches are
// linked by id and same second (no date moved, nothing added or removed), so
// that remove can be told. An item whose history came back empty is left alone.
//
// App → Trakt: a removed watch removes ONE play, and never a guessed one
// (playToRemove): by its Trakt id, or a play at that exact second when Trakt
// has more plays there than the watches left here account for. None there at
// all: it is gone already. Otherwise the remove waits until a pull has linked
// the title's watches to their plays.

export type WatchSource = 'app' | 'trakt' | 'backfill'
export interface LocalWatch { id: string; watchedAt: string | null; historyId: number | null; source: WatchSource; createdAt?: string | null }
/** One play on Trakt: its history id and when (the epoch = unknown date). */
export interface TraktPlay { historyId: number; watchedAt: string }
export interface KeyedPlay extends TraktPlay { key: string; kind: 'movie' | 'episode'; tmdbId: number; season?: number; episode?: number }

export interface WatchUpdate { id: string; watchedAt: string | null; historyId: number; source: WatchSource }
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

/**
 * One item: the watches here made to match Trakt's plays of it. `linkOnly`:
 * only link watches to plays by id and same second — no date moves, nothing
 * added or removed (an item whose single-play remove waits for the ids).
 */
export function matchItem(kind: 'movie' | 'episode', local: LocalWatch[], plays: TraktPlay[], opts: { linkOnly?: boolean } = {}): ItemMatch {
  const updates: WatchUpdate[] = []
  const inserts: ItemMatch['inserts'] = []
  const removes: string[] = []
  const byId = new Map(plays.map(p => [p.historyId, p]))
  const used = new Set<number>()
  const pool: LocalWatch[] = []
  const link = (w: LocalWatch, p: TraktPlay) => {
    used.add(p.historyId)
    const at = opts.linkOnly ? w.watchedAt : storedWatchedAt(kind, p.watchedAt)
    // A placeholder becomes Trakt's play; a watch added here stays the app's.
    const source: WatchSource = w.source === 'backfill' ? 'trakt' : w.source
    if (w.historyId !== p.historyId || source !== w.source || !sameSecond(w.watchedAt, at) || (w.watchedAt === null) !== (at === null)) {
      updates.push({ id: w.id, watchedAt: at, historyId: p.historyId, source })
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
  if (opts.linkOnly) return { updates, inserts, removes }
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
  /** Of those, the items whose only waiting change is a single-play remove waiting for the ids: linked only. */
  linkOnly?: Set<string>
}

export function buildWatchPlan(input: WatchPlanInput): WatchPlan {
  const plan: WatchPlan = { updates: [], inserts: [], removes: [], skipped: [] }
  for (const key of [...input.watched].sort()) {
    if (!input.read.has(key)) continue
    const linkOnly = input.pending.has(key)
    if (linkOnly && !input.linkOnly?.has(key)) continue
    const plays = input.plays.get(key) ?? []
    if (!plays.length) { plan.skipped.push(key); continue }
    const kind = key.startsWith('movie:') ? 'movie' : 'episode'
    const m = matchItem(kind, input.local.get(key) ?? [], plays, { linkOnly })
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

/** What the watches of one item here add up to: how many, the latest date, any not linked to a play yet. */
export interface LocalPlays { count: number; latest: string | null; unlinked: boolean }

/** The per-item summary of a set of watches (the cache columns give the same count and latest date). */
export function localPlays(watches: Map<string, LocalWatch[]>): Map<string, LocalPlays> {
  const out = new Map<string, LocalPlays>()
  for (const [key, ws] of watches) {
    const latest = ws.reduce<string | null>((x, w) => (secondOf(w.watchedAt) > secondOf(x) ? w.watchedAt : x), null)
    out.set(key, { count: ws.length, latest, unlinked: ws.some(w => w.historyId == null) })
  }
  return out
}

/**
 * The titles whose plays here differ from Trakt's watched summary (another
 * count, another latest date, or a watch not linked to a play yet) — their
 * history is read one by one when there are few. An item waiting in the
 * outbox is left out unless only a single-play remove waits there (`linkOnly`:
 * its watches get linked, so the remove can be told).
 */
export function historyTargets(snap: TraktSnapshot, local: Map<string, LocalPlays>, pending: Set<string>, linkOnly: Set<string> = new Set()): HistoryTargets {
  const out: HistoryTargets = { shows: new Map(), movies: new Map(), needsFull: false }
  const differs = (key: string, plays: number, at: string | null) => {
    if (pending.has(key) && !linkOnly.has(key)) return false
    const mine = local.get(key)
    if (!mine || mine.count !== plays || mine.unlinked) return true
    return !!at && !sameSecond(mine.latest, at)
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

/** A title of Trakt's watched summary: its key ('movie:<tmdb>' | 'show:<tmdb>'), TMDB and Trakt ids. */
export interface SummaryTitle { key: string; kind: 'movie' | 'show'; tmdb: number; trakt: number }

/**
 * Every title Trakt's watched summary lists, in one fixed order — a whole
 * history read goes through them title by title and keeps its place
 * (trakt_sync_state.history_cursor = the last key done), so it resumes in the
 * next run instead of depending on one run's time.
 */
export function summaryTitles(snap: TraktSnapshot): SummaryTitle[] {
  const out: SummaryTitle[] = []
  for (const m of snap.watchedMovies) if (m.item.ids.tmdb) out.push({ key: `movie:${m.item.ids.tmdb}`, kind: 'movie', tmdb: m.item.ids.tmdb, trakt: m.item.ids.trakt })
  for (const sh of snap.watchedShows) if (sh.item.ids.tmdb) out.push({ key: `show:${sh.item.ids.tmdb}`, kind: 'show', tmdb: sh.item.ids.tmdb, trakt: sh.item.ids.trakt })
  return out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** The titles still to read after `cursor` ('' = from the start). */
export const titlesAfter = (titles: SummaryTitle[], cursor: string) => titles.filter(t => t.key > cursor)

/** The item keys of one title in Trakt's summary (a movie's own key, a show's episodes). */
export function titleItemKeys(snap: TraktSnapshot, title: SummaryTitle): string[] {
  if (title.kind === 'movie') return [watchKey.movie(title.tmdb)]
  const sh = snap.watchedShows.find(x => x.item.ids.tmdb === title.tmdb)
  return (sh?.episodes ?? []).map(([season, episode]) => watchKey.episode(title.tmdb, season, episode))
}

/**
 * A pull never removes a big part of the watches here by itself: more than
 * max(10, 10 %) of them at once waits for the owner's confirm (the Trakt
 * card's "Sync anyway"), like the library's own removals.
 */
export function watchRemovalsNeedConfirm(plan: WatchPlan, localCount: number): boolean {
  return plan.removes.length > Math.max(10, Math.floor(localCount * 0.1))
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

/** What to do with a removed watch's play: remove this one, nothing (it is gone), or wait for the ids. */
export type PlayRemoval = { kind: 'remove'; historyId: number } | { kind: 'gone' } | { kind: 'wait' }

/**
 * The Trakt play a removed watch was — never a guess. By its own Trakt id
 * (gone when Trakt no longer has it); without one, only a play at that exact
 * second when Trakt has more plays there than the watches left here account
 * for (their linked plays, and one each for the unlinked ones at that
 * second). No play there that a watch left here doesn't hold: gone already
 * (never added, or removed with the whole item). Anything else waits until a
 * pull has linked the title's watches.
 */
export function playToRemove(removed: { historyId: number | null; watchedAt: string | null }, plays: TraktPlay[], keep: { historyId: number | null; watchedAt: string | null }[]): PlayRemoval {
  if (removed.historyId != null) return plays.some(p => p.historyId === removed.historyId) ? { kind: 'remove', historyId: removed.historyId } : { kind: 'gone' }
  const t = secondOf(removed.watchedAt)
  const keptIds = new Set(keep.filter(k => k.historyId != null).map(k => k.historyId!))
  const open = plays.filter(p => secondOf(p.watchedAt) === t && !keptIds.has(p.historyId)).sort((a, b) => b.historyId - a.historyId)
  if (!open.length) return { kind: 'gone' }
  const claimed = keep.filter(k => k.historyId == null && secondOf(k.watchedAt) === t).length
  return open.length > claimed ? { kind: 'remove', historyId: open[0].historyId } : { kind: 'wait' }
}

/**
 * Outbox rows that cancel out before anything is sent — every waiting row,
 * whatever its next_retry_at, in send order (seq):
 *   · an add not sent yet (or failed and waiting), then a remove of that watch
 *     (removed, or re-dated): both go, Trakt never gets that play;
 *   · a remove, then an add of the same watch at the same second (deleted,
 *     then Undo before the drain): both go, Trakt keeps the play it has.
 * Never across a whole-item remove (history_remove) of that item between the
 * two: it removes every play of the item, so what came before it and what
 * comes after it are both still needed.
 */
export function cancelledOutboxRows(rows: { id: string; op: string; item_key?: string | null; payload?: Record<string, unknown> | null }[]): string[] {
  const out: string[] = []
  const adds = new Map<string, { id: string; key: string }>()
  const removes = new Map<string, { id: string; at: string | null; key: string }>()
  for (const r of rows) {
    const key = r.item_key ?? ''
    if (r.op === 'history_remove') {
      for (const [w, a] of adds) if (a.key === key) adds.delete(w)
      for (const [w, x] of removes) if (x.key === key) removes.delete(w)
      continue
    }
    const watch = typeof r.payload?.watch_id === 'string' ? r.payload.watch_id : null
    if (!watch) continue
    const at = typeof r.payload?.watched_at === 'string' ? r.payload.watched_at : null
    if (r.op === 'history_add') {
      const rem = removes.get(watch)
      if (rem && sameSecond(rem.at, at)) { out.push(rem.id, r.id); removes.delete(watch); continue }
      adds.set(watch, { id: r.id, key })
    } else if (r.op === 'history_remove_play') {
      const add = adds.get(watch)
      if (add) { out.push(add.id, r.id); adds.delete(watch); continue }
      removes.set(watch, { id: r.id, at, key })
    }
  }
  return out
}

/**
 * The items whose only waiting outbox rows are single-play removes (waiting
 * for Trakt's play ids): the pull links their watches instead of leaving
 * them alone, so those removes can be told. Items just sent this run (`sent`)
 * stay left alone.
 */
export function linkOnlyKeys(rows: { op: string; item_key: string }[], sent: Iterable<string> = []): Set<string> {
  const other = new Set<string>(sent)
  const out = new Set<string>()
  for (const r of rows) if (r.op !== 'history_remove_play') other.add(r.item_key)
  for (const r of rows) if (r.op === 'history_remove_play' && !other.has(r.item_key)) out.add(r.item_key)
  return out
}
