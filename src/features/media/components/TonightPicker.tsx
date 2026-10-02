import { useState } from 'react'
import { Dices, Film, Shuffle, Tv } from 'lucide-react'
import { Button, Card, CardHeader, IconButton, SegmentedControl } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import { haptic } from '../../../shared/utils/haptics'
import {
  useTrendingMovies, useTrendingTV,
  usePopularMovies, usePopularTV, useShortTitles,
} from '../hooks/useTMDB'
import { useMediaPrefs } from '../mediaPrefsStore'
import { useTraktListItems, useTraktLists } from '../trakt/useTraktExtras'
import { useTraktStatus } from '../trakt/useTrakt'
import type { MediaType, UserMovieEntry, UserTVEntry, OpenMediaDetail } from '../types'

type Source = 'mylist' | 'trending' | 'popular' | 'list'

const LENGTHS: { value: 0 | 90 | 120; label: string }[] = [
  { value: 0, label: 'Any length' }, { value: 90, label: '≤ 90 min' }, { value: 120, label: '≤ 2 h' },
]

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
  onOpenDetail: OpenMediaDetail
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
  onOpenDetail: OpenMediaDetail
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

  const { tonightMax: max, setTonightMax } = useMediaPrefs()
  const { data: trakt } = useTraktStatus()
  const lists = useTraktLists(source === 'list')
  const [listId, setListId] = useState<number | null>(null)
  const activeList = listId ?? lists.data?.[0]?.id ?? null
  const listItems = useTraktListItems(source === 'list' ? activeList : null)

  // TMDB pools load only when that source is picked (My list needs none).
  // With a length limit the TMDB sources become "popular / most voted titles
  // no longer than N minutes" (TMDB discover with_runtime).
  const pooled = source === 'trending' || source === 'popular'
  const { data: trendMovies  = [] } = useTrendingMovies('week', source === 'trending' && !max)
  const { data: trendTV      = [] } = useTrendingTV('week', source === 'trending' && !max)
  const { data: popMovies    = [] } = usePopularMovies(source === 'popular' && !max)
  const { data: popTV        = [] } = usePopularTV(source === 'popular' && !max)
  const sort = source === 'trending' ? 'popularity.desc' : 'vote_count.desc'
  const { data: shortMovies  = [] } = useShortTitles('movie', max, sort, pooled && max > 0)
  const { data: shortTV      = [] } = useShortTitles('tv', max, sort, pooled && max > 0)

  function buildPool(type: 'movie' | 'tv'): Candidate[] {
    const fits = (min: number | null | undefined) => !max || (!!min && min <= max)
    if (source === 'list') {
      const runtimes = new Map<string, number | null>([
        ...movieEntries.map(e => [`movie:${e.movie.tmdb_id}`, e.movie.runtime] as const),
        ...tvEntries.map(e => [`tv:${e.tv_series.tmdb_id}`, e.tv_series.episode_run_time] as const),
      ])
      return (listItems.data ?? [])
        .filter(i => i.tmdb && (i.type === 'show' ? 'tv' : 'movie') === type)
        .filter(i => { const r = runtimes.get(`${type}:${i.tmdb}`); return r === undefined || fits(r) })
        .map(i => ({ id: i.tmdb!, title: i.title, poster_path: i.posterPath, kind: type }))
    }
    if (source === 'mylist') {
      if (type === 'movie') {
        return movieEntries
          .filter(e => (e.status === 'wishlist' || e.status === 'watching') && fits(e.movie.runtime))
          .map(e => ({
            id:          e.movie.tmdb_id,
            title:       e.movie.title,
            poster_path: e.movie.poster_path,
            kind:        'movie' as const,
            status:      e.status,
          }))
      }
      return tvEntries
        .filter(e => ['wishlist', 'watching', 'paused'].includes(e.status) && fits(e.tv_series.episode_run_time))
        .map(e => ({
          id:          e.tv_series.tmdb_id,
          title:       e.tv_series.title,
          poster_path: e.tv_series.poster_path,
          kind:        'tv' as const,
          status:      e.status,
        }))
    }

    const raw = max > 0
      ? (type === 'movie' ? shortMovies : shortTV)
      : source === 'trending'
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
          ...(trakt?.connected ? [{ value: 'list' as const, label: 'A list' }] : []),
        ]}
      />
      {source === 'list' && (
        <select
          aria-label="List to pick from"
          className="input mt-2 w-full max-w-md"
          value={activeList ?? ''}
          onChange={e => { setListId(Number(e.target.value)); setMoviePick(null); setTvPick(null) }}
        >
          {(lists.data ?? []).map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          {lists.data?.length === 0 && <option value="">No lists yet — make one (e.g. “Watch together”) in Lists</option>}
        </select>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {LENGTHS.map(l => (
          <button key={l.value} type="button" aria-pressed={max === l.value}
            onClick={() => { setTonightMax(l.value); setMoviePick(null); setTvPick(null) }}
            className="chip press-feedback aria-pressed:bg-accent-50 aria-pressed:text-accent-700">
            {l.label}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <PickRow type="movie" pick={moviePick} shaking={shaking === 'movie'} onRoll={() => roll('movie')} onOpenDetail={onOpenDetail} />
        <PickRow type="tv" pick={tvPick} shaking={shaking === 'tv'} onRoll={() => roll('tv')} onOpenDetail={onOpenDetail} />
      </div>
    </Card>
  )
}
