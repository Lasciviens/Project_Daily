import { formatDate } from '../../../shared/utils/dateFormat'
import { useTraktPlayback } from '../trakt/useTraktExtras'
import type { UserMovieEntry } from '../types'

/**
 * When a Watching movie was being watched. Movies keep no start date here, so
 * the answer is Trakt's paused playback (how far in, and when it was paused —
 * what an import from Trakt's Continue watching came from); without one, the
 * day it was added to the library.
 */
export function MovieWatchingInfo({ entry }: { entry: UserMovieEntry }) {
  const { data } = useTraktPlayback()
  const playback = data?.find(p => p.type === 'movie' && p.tmdb === entry.movie.tmdb_id)
  const text = playback
    ? `Paused at ${Math.round(playback.progress)}%${playback.pausedAt ? ` on ${formatDate(playback.pausedAt)}` : ''}`
    : `Watching · in your library since ${formatDate(entry.created_at)}`
  return <p className="text-meta text-fg-muted tabular-nums">{text}</p>
}
