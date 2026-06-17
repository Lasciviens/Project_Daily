import { useState } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry, UserTVEntry } from '../types'

type Filter = 'all' | 'movie' | 'tv'
type PickedEntry = (UserMovieEntry & { kind: 'movie' }) | (UserTVEntry & { kind: 'tv' })

interface Props {
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

export function TonightPicker({ movieEntries, tvEntries, onOpenDetail }: Props) {
  const [filter,  setFilter]  = useState<Filter>('all')
  const [picked,  setPicked]  = useState<PickedEntry | null>(null)
  const [shaking, setShaking] = useState(false)

  const wishlistMovies = movieEntries.filter(e => e.status === 'wishlist')
  const wishlistTV     = tvEntries.filter(e => e.status === 'wishlist')
  const watchingMovies = movieEntries.filter(e => e.status === 'watching')
  const watchingTV     = tvEntries.filter(e => e.status === 'watching' || e.status === 'paused')

  function buildPool(): PickedEntry[] {
    const movies: PickedEntry[] = [...wishlistMovies, ...watchingMovies].map(e => ({ ...e, kind: 'movie' as const }))
    const tv:     PickedEntry[] = [...watchingTV, ...wishlistTV].map(e => ({ ...e, kind: 'tv' as const }))
    if (filter === 'movie') return movies
    if (filter === 'tv')    return tv
    return [...movies, ...tv]
  }

  function roll() {
    const pool = buildPool()
    if (!pool.length) return
    setShaking(true)
    setTimeout(() => setShaking(false), 400)
    let candidate: PickedEntry
    do {
      candidate = pool[Math.floor(Math.random() * pool.length)]
    } while (pool.length > 1 && candidate.id === picked?.id)
    setPicked(candidate)
  }

  const total = buildPool().length

  const title = picked
    ? picked.kind === 'movie'
      ? (picked as UserMovieEntry).movie.title
      : (picked as UserTVEntry).tv_series.title
    : null

  const poster = picked
    ? picked.kind === 'movie'
      ? (picked as UserMovieEntry).movie.poster_path
      : (picked as UserTVEntry).tv_series.poster_path
    : null

  const tmdbId = picked
    ? picked.kind === 'movie'
      ? (picked as UserMovieEntry).movie.tmdb_id
      : (picked as UserTVEntry).tv_series.tmdb_id
    : null

  return (
    <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-accent-50 to-cream-100 border border-accent-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-ink-900">🎲 Bu gece ne izlesem?</h3>
        <div className="flex gap-1">
          {(['all', 'movie', 'tv'] as Filter[]).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setPicked(null) }}
              className={`text-[10px] px-2.5 min-h-[44px] rounded font-medium transition-colors duration-150 ${
                filter === f ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100'
              }`}
            >
              {f === 'all' ? 'All' : f === 'movie' ? '🎬' : '📺'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 items-center">
        {picked && (
          <div
            className={`flex-shrink-0 cursor-pointer ${shaking ? 'animate-[wiggle_0.3s_ease-in-out]' : ''}`}
            onClick={() => tmdbId && onOpenDetail(tmdbId, picked.kind === 'movie' ? 'movie' : 'tv')}
          >
            <img
              src={posterUrl(poster, 'w185')}
              alt={title ?? ''}
              className="w-16 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-150"
            />
          </div>
        )}

        <div className="flex-1">
          {picked ? (
            <div>
              <p className="text-sm font-semibold text-ink-900 leading-snug mb-0.5">{title}</p>
              <p className="text-[10px] text-ink-500 capitalize mb-2">
                {picked.kind === 'movie' ? '🎬 Movie' : '📺 TV'} · {picked.status}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => tmdbId && onOpenDetail(tmdbId, picked.kind === 'movie' ? 'movie' : 'tv')}
                  className="text-xs px-3 min-h-[44px] rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors duration-150"
                >
                  Details
                </button>
                <button
                  onClick={roll}
                  className="text-xs px-3 min-h-[44px] rounded-lg border border-ink-200 text-ink-600 hover:bg-ink-50 transition-colors duration-150"
                >
                  Reroll
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-ink-500 mb-2">
                {total > 0 ? `${total} titles in your list` : 'Add items to wishlist or watching first'}
              </p>
              <button
                onClick={roll}
                disabled={total === 0}
                className="text-sm px-4 min-h-[44px] rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-150"
              >
                Pick for me 🎲
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
