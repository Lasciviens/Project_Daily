import type { UserMovieEntry, UserTVEntry } from './types'
import type { Tone } from '../../shared/ui/Tone'
import { stageTones, type Stage } from '../../shared/theme/stage'

// The library as one flat list of posters, shared by the Media overview's
// summary and the Library view. Pure and type-only
// (scripts/verify-media-library.cjs).
//
// "Coming soon" is a DATE fact (release/first air date in the future), not a
// manual label: Wishlist = "want to watch, and it's out"; Coming soon = "not
// out yet". The legacy manual `upcoming` movie status shares the wishlist
// pool and is split by date the same way.

export type LibraryBucket = 'coming' | 'wishlist' | 'watching' | 'paused' | 'completed' | 'dropped'
export type LibrarySort = 'added' | 'title' | 'year' | 'rating' | 'rt'

export interface LibraryItem {
  tmdbId: number
  title: string
  year: number | null
  posterPath: string | null
  bucket: LibraryBucket
  rating: number | null
  addedAt: string
  /** Rotten Tomatoes Tomatometer (MDBList), when known. */
  rt?: number | null
  favorite?: boolean
  /** Watched at a cinema at least once (movie_cinema_visits, migration 120). */
  cinema?: boolean
  /** TMDB's original language (ISO 639-1, e.g. "ja"), from the stored record. */
  language?: string | null
  /** Release (movie) or first air date (TV), yyyy-MM-dd. */
  releaseDate?: string | null
}

export const BUCKET_LABEL: Record<LibraryBucket, string> = {
  coming: 'Coming soon',
  wishlist: 'Wishlist',
  watching: 'Watching',
  paused: 'Paused',
  completed: 'Completed',
  dropped: 'Dropped',
}

/** Each status's shared stage (shared/theme/stage.ts) — the one colour rule for every page. */
export const BUCKET_STAGE: Record<LibraryBucket, Stage> = {
  completed: 'done',
  watching: 'active',
  paused: 'paused',
  coming: 'upcoming',
  wishlist: 'planned',
  dropped: 'dropped',
}

/** The poster ribbon's tone per status (a tone, never the accent). */
export const BUCKET_TONE: Record<LibraryBucket, Tone> = stageTones(BUCKET_STAGE)

/** Reading order: what you're in the middle of first, then what's next, then the rest. */
export const BUCKET_ORDER: LibraryBucket[] = ['watching', 'paused', 'coming', 'wishlist', 'completed', 'dropped']

const yearOf = (d: string | null | undefined) => (d ? Number(d.slice(0, 4)) || null : null)

function bucketFor(status: string, date: string | null, today: string): LibraryBucket | null {
  if (status === 'wishlist' || status === 'upcoming') return date && date > today ? 'coming' : 'wishlist'
  if (status === 'watching' || status === 'paused' || status === 'completed' || status === 'dropped') return status
  return null
}

export function libraryItems(tab: 'movies' | 'tv', movies: UserMovieEntry[], tv: UserTVEntry[], today: string, cinemaMovieIds?: ReadonlySet<string>): LibraryItem[] {
  const out: LibraryItem[] = []
  if (tab === 'movies') {
    for (const e of movies) {
      const bucket = bucketFor(e.status, e.movie.release_date, today)
      if (bucket) out.push({ tmdbId: e.movie.tmdb_id, title: e.movie.title, year: yearOf(e.movie.release_date), posterPath: e.movie.poster_path, bucket, rating: e.rating, addedAt: e.created_at, rt: e.movie.rt_critics ?? null, favorite: !!e.is_favorite, cinema: !!cinemaMovieIds?.has(e.movie_id), language: e.movie.metadata_json?.original_language ?? null, releaseDate: e.movie.release_date })
    }
  } else {
    for (const e of tv) {
      const bucket = bucketFor(e.status, e.tv_series.first_air_date, today)
      if (bucket) out.push({ tmdbId: e.tv_series.tmdb_id, title: e.tv_series.title, year: yearOf(e.tv_series.first_air_date), posterPath: e.tv_series.poster_path, bucket, rating: e.rating, addedAt: e.created_at, rt: e.tv_series.rt_critics ?? null, favorite: !!e.is_favorite, language: e.tv_series.metadata_json?.original_language ?? null, releaseDate: e.tv_series.first_air_date })
    }
  }
  return out
}

export function bucketCounts(items: LibraryItem[]): Record<LibraryBucket, number> {
  const c: Record<LibraryBucket, number> = { coming: 0, wishlist: 0, watching: 0, paused: 0, completed: 0, dropped: 0 }
  for (const i of items) c[i.bucket]++
  return c
}

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Items in one bucket (or all), matching the search, in the chosen order. Titles break ties. */
export function filterLibrary(items: LibraryItem[], bucket: LibraryBucket | 'all', query: string, sort: LibrarySort): LibraryItem[] {
  const q = fold(query.trim())
  const list = items.filter(i => (bucket === 'all' || i.bucket === bucket) && (!q || fold(i.title).includes(q)))
  const byTitle = (a: LibraryItem, b: LibraryItem) => a.title.localeCompare(b.title)
  const cmp: Record<LibrarySort, (a: LibraryItem, b: LibraryItem) => number> = {
    added: (a, b) => b.addedAt.localeCompare(a.addedAt) || byTitle(a, b),
    title: byTitle,
    // No year / no rating sorts last, whichever way the list runs.
    year: (a, b) => (b.year ?? -1) - (a.year ?? -1) || byTitle(a, b),
    rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b),
    rt: (a, b) => (b.rt ?? -1) - (a.rt ?? -1) || byTitle(a, b),
  }
  return list.sort(cmp[sort])
}

/** The overview's poster row: what you're watching, then what's coming, most recently added first. */
export function summaryPosters(items: LibraryItem[], max = 10): LibraryItem[] {
  const pick = (b: LibraryBucket) => items.filter(i => i.bucket === b).sort((x, y) => y.addedAt.localeCompare(x.addedAt))
  return [...pick('watching'), ...pick('paused'), ...pick('coming'), ...pick('wishlist')].slice(0, max)
}

