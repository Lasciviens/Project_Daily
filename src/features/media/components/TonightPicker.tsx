import { useState } from 'react'
import { Dices, Film, Shuffle, Tv } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, SegmentedControl } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import { haptic } from '../../../shared/utils/haptics'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV,
} from '../hooks/useTMDB'
import type { MediaType, UserMovieEntry, UserTVEntry } from '../types'

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
  onOpenDetail: (id: number, type: MediaType) => void
}

// buildPool() creates fresh Candidate objects every call, so comparing by
// reference (x !== exclude) never actually excludes anything — compare by id
// instead so re-rolling doesn't keep landing on the same title.
function pickRandom(arr: Candidate[], exclude?: Candidate): Candidate {
  const pool = arr.length > 1 && exclude ? arr.filter(x => x.id !== exclude.id) : arr
  return pool[Math.floor(Math.random() * pool.length)]
}

function PickRow({ type, pick, shaking, onRoll, onOpenDetail }: {
  type:         MediaType
  pick:         Candidate | null
  shaking:      boolean
  onRoll:       () => void
  onOpenDetail: (id: number, type: MediaType) => void
}) {
  if (pick) {
    return (
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => { haptic('light'); onOpenDetail(pick.id, type) }}
          aria-label={`Open ${pick.title}`}
          className={`press-feedback shrink-0 rounded-md ${shaking ? 'animate-[wiggle_0.3s_ease-in-out]' : ''}`}
        >
          <img src={posterUrl(pick.poster_path, 'w92')} alt="" className="h-[54px] w-9 rounded-md bg-surface-2 object-cover" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-fg">{pick.title}</p>
          {pick.status && <p className="text-meta capitalize text-fg-muted">{pick.status}</p>}
        </div>
        <Button size="sm" variant="primary" onClick={() => { haptic('light'); onOpenDetail(pick.id, type) }}>View</Button>
        <IconButton label="Pick another" bordered onClick={() => { haptic('light'); onRoll() }}>
          <Shuffle />
        </IconButton>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => { haptic('light'); onRoll() }}
      className="press-feedback flex min-h-[44px] w-full items-center justify-center gap-2 rounded-row border border-dashed border-line-strong text-body font-medium text-fg-2 transition-colors hover:border-accent-500 hover:text-accent-600"
    >
      {type === 'movie' ? <Film aria-hidden className="h-4 w-4" /> : <Tv aria-hidden className="h-4 w-4" />}
      {type === 'movie' ? 'Random movie' : 'Random series'}
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
    <Card>
      <CardHeader title="What to watch?" icon={<Dices />} />
      <SegmentedControl<Source>
        value={source}
        onChange={s => { haptic('light'); setSource(s); setMoviePick(null); setTvPick(null) }}
        size="sm"
        fullWidth
        options={[
          { value: 'mylist', label: 'My list' },
          { value: 'trending', label: 'Trending' },
          { value: 'popular', label: 'Popular' },
        ]}
      />
      <div className="mt-3 space-y-2">
        <PickRow type="movie" pick={moviePick} shaking={shaking === 'movie'} onRoll={() => roll('movie')} onOpenDetail={onOpenDetail} />
        <PickRow type="tv" pick={tvPick} shaking={shaking === 'tv'} onRoll={() => roll('tv')} onOpenDetail={onOpenDetail} />
      </div>
    </Card>
  )
}
