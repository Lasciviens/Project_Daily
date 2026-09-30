import type { LocalLibrary, TraktItem, TraktSnapshot } from './traktTypes'
import { movieWatchedAt } from './traktDates'

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

export interface ShowInfo { aired: number }

export interface MovieWrite {
  tmdbId: number
  item: TraktItem | null
  status: string
  repeatCount: number
  watchedAt: string | null
  rating: number | null
  watchlistRank: number | null
}
export interface ShowWrite {
  tmdbId: number
  item: TraktItem | null
  status: string
  rating: number | null
  watchlistRank: number | null
}
export interface EpisodeWrite { tmdbId: number; season: number; episode: number; repeatCount: number; watchedAt: string }

export interface PushPlan {
  history: { movies: { tmdb: number; watchedAt: string | null }[]; episodes: { tmdb: number; season: number; episode: number; watchedAt: string | null }[] }
  ratings: { movies: { tmdb: number; rating: number }[]; shows: { tmdb: number; rating: number }[] }
  watchlistAdd: { movies: { tmdb: number }[]; shows: { tmdb: number }[] }
  watchlistRemove: { movies: { tmdb: number }[]; shows: { tmdb: number }[] }
  /** Shows dropped here but not on Trakt → Trakt's hidden "dropped" section. */
  droppedAdd: { shows: { tmdb: number }[] }
}

export interface ImportPlan {
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

export const KEEP_MOVIE = new Set(['watching', 'dropped', 'upcoming'])
export const IN_PROGRESS_SHOW = new Set(['watching', 'completed', 'paused'])

/** Shows whose TMDB details the plan needs to settle Completed vs Watching. */
export function showsNeedingInfo(snap: TraktSnapshot, local: LocalLibrary): number[] {
  const ids = new Set<number>()
  for (const w of snap.watchedShows) if (w.item.ids.tmdb && w.episodes.length) ids.add(w.item.ids.tmdb)
  for (const e of local.episodes) ids.add(e.tmdbId)
  return [...ids]
}

export function buildImportPlan(snap: TraktSnapshot, local: LocalLibrary, info: Map<number, ShowInfo>): ImportPlan {
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
    const aired = info.get(id)?.aired ?? 0
    let status: string
    if (union.size) {
      status = isDropped ? 'dropped'
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
export function airedEpisodes(details: {
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

export function pushCount(p: PushPlan): number {
  return p.history.movies.length + p.history.episodes.length + p.ratings.movies.length + p.ratings.shows.length
    + p.watchlistAdd.movies.length + p.watchlistAdd.shows.length + p.watchlistRemove.movies.length + p.watchlistRemove.shows.length
    + p.droppedAdd.shows.length
}
