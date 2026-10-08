// The shapes trakt-api's `snapshot` action returns (mirrors
// supabase/functions/trakt-api/index.ts) and the library slice the preview
// compares them with. Type-only, so scripts can load the pure modules.

import type { LocalNote, TraktNote } from './traktNotes'

export interface TraktIds {
  trakt: number
  slug: string | null
  tmdb: number | null
  imdb: string | null
  tvdb: number | null
}

export interface TraktItem {
  type: 'movie' | 'show'
  ids: TraktIds
  title: string
  year: number | null
}

/** [season, episode, plays, lastWatchedAt] */
export type TraktEpisodeTuple = [number, number, number, string | null]

export interface TraktSnapshot {
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

export interface TraktStatus {
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
export interface LocalMovie { tmdbId: number; title: string; year: number | null; status: string; repeatCount: number; rating: number | null; watchedAt?: string | null; watchlistRank?: number | null; note?: string | null }
export interface LocalShow { tmdbId: number; title: string; year: number | null; status: string; rating: number | null; watchlistRank?: number | null; note?: string | null }
export interface LocalEpisode { tmdbId: number; season: number; episode: number; repeatCount: number; watchedAt?: string | null }
export interface LocalLibrary { movies: LocalMovie[]; shows: LocalShow[]; episodes: LocalEpisode[]; notes?: LocalNote[] }
