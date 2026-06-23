import { useState } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
} from '../hooks/useTMDB'
import type { UserMovieEntry, UserTVEntry } from '../types'

type Source = 'mylist' | 'trending' | 'popular'

interface Candidate {
  id:          number
  title:       string
  poster_path: string | null
  kind:        'movie' | 'tv'
  status?:     string
}

interface Props {
  movieEntries: UserMovieEntry[]
  tvEntries:    UserTVEntry[]
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}

function pickRandom<T>(arr: T[], exclude?: T): T {
  const pool = arr.length > 1 ? arr.filter(x => x !== exclude) : arr
  return pool[Math.floor(Math.random() * pool.length)]
}

function PickRow({ type, pick, shaking, onRoll, onOpenDetail }: {
  type:         'movie' | 'tv'
  pick:         Candidate | null
  shaking:      boolean
  onRoll:       () => void
  onOpenDetail: (id: number, type: 'movie' | 'tv') => void
}) {
  if (pick) {
    return (
      <div className="flex items-center gap-2">
        <img
          src={posterUrl(pick.poster_path, 'w92')}
          alt={pick.title}
          onClick={() => onOpenDetail(pick.id, type)}
          className={`w-9 h-[52px] rounded object-cover cursor-pointer flex-shrink-0 hover:opacity-90 ${shaking ? 'animate-[wiggle_0.3s_ease-in-out]' : ''}`}
        />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-semibold text-ink-900 truncate leading-tight">{pick.title}</p>
          {pick.status && (
            <p className="text-[9px] text-ink-400 capitalize mt-0.5">{pick.status}</p>
          )}
        </div>
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            onClick={() => onOpenDetail(pick.id, type)}
            className="text-[9px] px-1.5 py-1 rounded bg-accent-500 text-white hover:bg-accent-600 min-h-[24px] transition-colors"
          >
            View
          </button>
          <button
            onClick={onRoll}
            className="text-[9px] px-1.5 py-1 rounded border border-ink-200 text-ink-500 hover:bg-ink-50 min-h-[24px] transition-colors"
          >
            ↺
          </button>
        </div>
      </div>
    )
  }

  return (
    <button
      onClick={onRoll}
      className="w-full flex items-center justify-center gap-1.5 min-h-[44px] rounded-lg border border-dashed border-ink-300 text-xs text-ink-500 hover:bg-ink-50 hover:border-accent-400 hover:text-accent-600 transition-colors"
    >
      {type === 'movie' ? '🎬 Random Movie' : '📺 Random Series'}
    </button>
  )
}

export function TonightPicker({ movieEntries, tvEntries, onOpenDetail }: Props) {
  const [source,     setSource]     = useState<Source>('mylist')
  const [moviePick,  setMoviePick]  = useState<Candidate | null>(null)
  const [tvPick,     setTvPick]     = useState<Candidate | null>(null)
  const [shaking,    setShaking]    = useState<'movie' | 'tv' | null>(null)

  // Always fetch TMDB pools (cached 1hr, cheap after first load)
  const { data: trendMovies  = [] } = useTrendingMovies('week')
  const { data: trendTV      = [] } = useTrendingTV('week')
  const { data: popMovies    = [] } = usePopularMovies()
  const { data: popTV        = [] } = usePopularTV()

  function buildPool(type: 'movie' | 'tv'): Candidate[] {
    if (source === 'mylist') {
      if (type === 'movie') {
        return movieEntries
          .filter(e => e.status === 'wishlist' || e.status === 'watching')
          .map(e => ({
            id:          e.movie.tmdb_id,
            title:       e.movie.title,
            poster_path: e.movie.poster_path,
            kind:        'movie' as const,
            status:      e.status,
          }))
      }
      return tvEntries
        .filter(e => ['wishlist', 'watching', 'paused'].includes(e.status))
        .map(e => ({
          id:          e.tv_series.tmdb_id,
          title:       e.tv_series.title,
          poster_path: e.tv_series.poster_path,
          kind:        'tv' as const,
          status:      e.status,
        }))
    }

    const raw = source === 'trending'
      ? (type === 'movie' ? trendMovies : trendTV)
      : (type === 'movie' ? popMovies   : popTV)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (raw as any[]).map(m => ({
      id:          m.id,
      title:       (m.title ?? m.name ?? '') as string,
      poster_path: m.poster_path as string | null,
      kind:        type,
    }))
  }

  function roll(type: 'movie' | 'tv') {
    const pool = buildPool(type)
    if (!pool.length) return
    setShaking(type)
    setTimeout(() => setShaking(null), 400)
    const prev = type === 'movie' ? moviePick : tvPick
    const pick = pickRandom(pool, prev ?? undefined)
    if (type === 'movie') setMoviePick(pick)
    else                  setTvPick(pick)
  }

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3">
      {/* Header + source selector */}
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-400">🎲 What to Watch?</h3>
        <div className="flex gap-0.5">
          {(['mylist', 'trending', 'popular'] as Source[]).map(s => (
            <button
              key={s}
              onClick={() => { setSource(s); setMoviePick(null); setTvPick(null) }}
              className={[
                'text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors min-h-[24px]',
                source === s ? 'bg-accent-500 text-white' : 'text-ink-400 hover:bg-ink-100',
              ].join(' ')}
            >
              {s === 'mylist' ? 'My List' : s === 'trending' ? 'Trending' : 'Popular'}
            </button>
          ))}
        </div>
      </div>

      {/* Movie + Series rows */}
      <div className="space-y-2">
        <PickRow
          type="movie"
          pick={moviePick}
          shaking={shaking === 'movie'}
          onRoll={() => roll('movie')}
          onOpenDetail={onOpenDetail}
        />
        <PickRow
          type="tv"
          pick={tvPick}
          shaking={shaking === 'tv'}
          onRoll={() => roll('tv')}
          onOpenDetail={onOpenDetail}
        />
      </div>
    </div>
  )
}
