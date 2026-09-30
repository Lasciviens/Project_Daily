import type { LocalLibrary, LocalMovie, LocalShow, TraktItem, TraktSnapshot } from './traktTypes'

// The first import's dry run (docs/trakt/PLAN.md §1): what importing Trakt
// would change here, and what the app holds that Trakt does not, without
// writing anything. Pure and import-free (scripts/verify-trakt-preview.cjs).
//
// Rules it counts by (the owner's decisions):
//   · one title = one row, matched by TMDB id; no TMDB id = unmatched, never guessed
//   · Trakt wins for anything it holds (watched, plays, rating, watchlist, dropped)
//   · app-only facts are listed as "to send to Trakt", never dropped
//   · plays = 1 + repeat_count

export interface PreviewTitle { kind: 'movie' | 'show'; title: string; year: number | null; tmdbId: number | null }
export interface PreviewChange extends PreviewTitle { detail: string }

export interface TraktPreview {
  movies: { add: PreviewTitle[]; update: PreviewChange[]; same: number; push: PreviewTitle[] }
  shows: { add: PreviewTitle[]; update: PreviewChange[]; same: number; push: PreviewTitle[] }
  episodes: { add: number; push: number; playsChanged: number; same: number }
  watchlist: { add: PreviewTitle[]; same: number; push: PreviewTitle[]; skippedWatched: number }
  ratings: { update: PreviewChange[]; same: number; push: PreviewTitle[] }
  favorites: { total: number; matched: number }
  dropped: { add: PreviewTitle[]; same: number; push: PreviewTitle[] }
  playback: number
  unmatched: PreviewTitle[]
  /** Local rows sharing one TMDB id — should always be 0 (the catalogue refuses them). */
  duplicateLocal: number
}

const title = (i: TraktItem): PreviewTitle => ({ kind: i.type, title: i.title, year: i.year, tmdbId: i.ids.tmdb })
const localTitle = (kind: 'movie' | 'show', l: LocalMovie | LocalShow): PreviewTitle =>
  ({ kind, title: l.title, year: l.year, tmdbId: l.tmdbId })
const plays = (repeatCount: number) => 1 + Math.max(0, repeatCount || 0)

function byTmdb<T extends { tmdbId: number }>(rows: T[]): { map: Map<number, T>; dupes: number } {
  const map = new Map<number, T>()
  let dupes = 0
  for (const r of rows) {
    if (map.has(r.tmdbId)) dupes++
    else map.set(r.tmdbId, r)
  }
  return { map, dupes }
}

export function buildTraktPreview(snap: TraktSnapshot, local: LocalLibrary): TraktPreview {
  const movies = byTmdb(local.movies)
  const shows = byTmdb(local.shows)
  const unmatched = new Map<string, PreviewTitle>()
  const noTmdb = (i: TraktItem) => {
    if (i.ids.tmdb) return false
    unmatched.set(`${i.type}:${i.ids.trakt}`, title(i))
    return true
  }

  // ── Movies ─────────────────────────────────────────────────────────────────
  const m: TraktPreview['movies'] = { add: [], update: [], same: 0, push: [] }
  const traktWatchedMovies = new Set<number>()
  for (const w of snap.watchedMovies) {
    if (noTmdb(w.item)) continue
    const id = w.item.ids.tmdb!
    traktWatchedMovies.add(id)
    const l = movies.map.get(id)
    if (!l) { m.add.push(title(w.item)); continue }
    const changes: string[] = []
    if (l.status !== 'completed') changes.push(`${l.status} → completed`)
    if (plays(l.repeatCount) !== w.plays) changes.push(`plays ${plays(l.repeatCount)} → ${w.plays}`)
    if (changes.length) m.update.push({ ...title(w.item), detail: changes.join(', ') })
    else m.same++
  }
  for (const l of movies.map.values()) {
    if (l.status === 'completed' && !traktWatchedMovies.has(l.tmdbId)) m.push.push(localTitle('movie', l))
  }

  // ── Shows + episodes ───────────────────────────────────────────────────────
  const s: TraktPreview['shows'] = { add: [], update: [], same: 0, push: [] }
  const e: TraktPreview['episodes'] = { add: 0, push: 0, playsChanged: 0, same: 0 }
  const localEps = new Map<number, Map<string, number>>()
  for (const ep of local.episodes) {
    const per = localEps.get(ep.tmdbId) ?? new Map<string, number>()
    per.set(`${ep.season}x${ep.episode}`, plays(ep.repeatCount))
    localEps.set(ep.tmdbId, per)
  }
  const traktWatchedShows = new Set<number>()
  for (const w of snap.watchedShows) {
    if (noTmdb(w.item)) continue
    const id = w.item.ids.tmdb!
    traktWatchedShows.add(id)
    const mine = localEps.get(id) ?? new Map<string, number>()
    const theirs = new Set<string>()
    let added = 0
    for (const [season, episode, p] of w.episodes) {
      const key = `${season}x${episode}`
      theirs.add(key)
      const have = mine.get(key)
      if (have == null) { e.add++; added++ }
      else if (have !== p) e.playsChanged++
      else e.same++
    }
    for (const key of mine.keys()) if (!theirs.has(key)) e.push++
    if (!shows.map.has(id)) s.add.push(title(w.item))
    else if (added) s.update.push({ ...title(w.item), detail: `${added} episode${added === 1 ? '' : 's'} to add` })
    else s.same++
  }
  for (const l of shows.map.values()) {
    if (!traktWatchedShows.has(l.tmdbId) && (localEps.get(l.tmdbId)?.size ?? 0) > 0) {
      s.push.push(localTitle('show', l))
      e.push += localEps.get(l.tmdbId)!.size
    }
  }

  // ── Watchlist ──────────────────────────────────────────────────────────────
  const wl: TraktPreview['watchlist'] = { add: [], same: 0, push: [], skippedWatched: 0 }
  const traktListed = new Set<string>()
  for (const w of snap.watchlist) {
    if (noTmdb(w.item)) continue
    const id = w.item.ids.tmdb!
    traktListed.add(`${w.item.type}:${id}`)
    const l = w.item.type === 'movie' ? movies.map.get(id) : shows.map.get(id)
    if (!l) wl.add.push(title(w.item))
    else if (l.status === 'wishlist') wl.same++
    // Already watched here: watched wins, the watchlist entry is left alone.
    else wl.skippedWatched++
  }
  for (const l of movies.map.values()) if (l.status === 'wishlist' && !traktListed.has(`movie:${l.tmdbId}`)) wl.push.push(localTitle('movie', l))
  for (const l of shows.map.values()) if (l.status === 'wishlist' && !traktListed.has(`show:${l.tmdbId}`)) wl.push.push(localTitle('show', l))

  // ── Ratings ────────────────────────────────────────────────────────────────
  const r: TraktPreview['ratings'] = { update: [], same: 0, push: [] }
  const traktRated = new Set<string>()
  for (const x of snap.ratings) {
    if (noTmdb(x.item)) continue
    const id = x.item.ids.tmdb!
    traktRated.add(`${x.item.type}:${id}`)
    const l = x.item.type === 'movie' ? movies.map.get(id) : shows.map.get(id)
    const mine = l?.rating ?? null
    if (mine === x.rating) r.same++
    else r.update.push({ ...title(x.item), detail: mine == null ? `rated ${x.rating}` : `${mine} → ${x.rating}` })
  }
  for (const l of movies.map.values()) if (l.rating != null && !traktRated.has(`movie:${l.tmdbId}`)) r.push.push(localTitle('movie', l))
  for (const l of shows.map.values()) if (l.rating != null && !traktRated.has(`show:${l.tmdbId}`)) r.push.push(localTitle('show', l))

  // ── Dropped shows ──────────────────────────────────────────────────────────
  const d: TraktPreview['dropped'] = { add: [], same: 0, push: [] }
  const traktDropped = new Set<number>()
  for (const x of snap.dropped) {
    if (noTmdb(x.item)) continue
    const id = x.item.ids.tmdb!
    traktDropped.add(id)
    if (shows.map.get(id)?.status === 'dropped') d.same++
    else d.add.push(title(x.item))
  }
  for (const l of shows.map.values()) if (l.status === 'dropped' && !traktDropped.has(l.tmdbId)) d.push.push(localTitle('show', l))

  // ── Favorites + playback ───────────────────────────────────────────────────
  const favMatched = snap.favorites.filter(f => !noTmdb(f.item)).length
  for (const p of snap.playback) noTmdb(p.item)

  return {
    movies: m, shows: s, episodes: e, watchlist: wl, ratings: r,
    favorites: { total: snap.favorites.length, matched: favMatched },
    dropped: d,
    playback: snap.playback.length,
    unmatched: [...unmatched.values()],
    duplicateLocal: movies.dupes + shows.dupes,
  }
}
