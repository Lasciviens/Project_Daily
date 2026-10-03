import type { LocalLibrary, TraktItem, TraktSnapshot } from './traktTypes'
import type { EpisodeWrite, MovieWrite, ShowInfo, ShowWrite } from './traktImportPlan'
import { IN_PROGRESS_SHOW, itemKey, playbackIds, sameTime } from './traktImportPlan'
import { movieWatchedAt } from './traktDates'

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

export interface EpisodeRef { tmdbId: number; season: number; episode: number }

export interface SyncPlan {
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
export function showsNeedingInfoForSync(snap: TraktSnapshot, local: LocalLibrary, pending: Set<string>): number[] {
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

export function buildSyncPlan(snap: TraktSnapshot, local: LocalLibrary, info: Map<number, ShowInfo>, pending: Set<string>): SyncPlan {
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

export const removalCount = (p: SyncPlan) => p.movieDeletes.length + p.showDeletes.length + p.episodeDeletes.length

/**
 * A sync never removes a big part of the library by itself: more than
 * max(10, 10 %) of it at once is held back until the owner confirms (a Trakt
 * outage returning an empty list must not empty the library).
 */
export function removalsNeedConfirm(p: SyncPlan, local: LocalLibrary): boolean {
  const size = local.movies.length + local.shows.length + local.episodes.length
  return removalCount(p) > Math.max(10, Math.floor(size * 0.1))
}

/**
 * The plan with its removals held back. A show whose status was counted
 * without the removed episodes gets the status it has with them (usually: no
 * change at all), so a held-back removal never moves a show's status.
 */
export function withoutRemovals(p: SyncPlan): SyncPlan {
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
export function lastActivitiesChange(prev: unknown, next: unknown): { changed: boolean; reset: boolean } {
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
