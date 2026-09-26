import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarPlus, Check, Clapperboard, Pause, Tv } from 'lucide-react'
import { Cell, CellHeader, CellLink } from './cellKit'
import { useMovies } from '../../../media/hooks/useMovies'
import { useTVSeries } from '../../../media/hooks/useTVSeries'
import { useNextEpisode } from '../../../media/hooks/useNextEpisode'
import { useMarkEpisodeWatched } from '../../../media/hooks/useWatchedEpisodes'
import { useEntityModal } from '../../../../shared/modals'
import { Button, TonePill } from '../../../../shared/ui'
import { posterUrl } from '../../../../integrations/tmdb/client'
import { fmtDateEnGB } from '../../../../shared/utils/enGBDate'

// ─────────────────────────────────────────────────────────────────────────────
//  Watch next v2 — driven by ACTUAL watched-episode rows (useNextEpisode),
//  never by the entry's cached S/E counters (which sat frozen at S1·E0 for
//  months — see migration 050). Switch between currently-watching shows,
//  see the real next unwatched episode, plan it for this day or mark it
//  watched (which auto-advances to the following episode via refetch).
// ─────────────────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0')

export function WatchNextCard({ date }: { date: string }) {
  const { data: movies = [] } = useMovies()
  const { data: tv = [] } = useTVSeries()

  // Currently-watching shows first, paused after (still resumable).
  const shows = useMemo(
    () => [...tv.filter(e => e.status === 'watching'), ...tv.filter(e => e.status === 'paused')],
    [tv],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const entry = shows.find(e => e.id === selectedId) ?? shows[0] ?? null

  const next = useNextEpisode(
    entry?.id ?? null,
    entry?.tv_series?.tmdb_id ?? null,
    entry?.tv_series?.number_of_episodes ?? null,
  )
  const modal = useEntityModal()

  const markEpisode = useMarkEpisodeWatched({ successMessage: 'Marked watched' })
  function markNextWatched() {
    const n = next.data
    // Guard a refetch race: never claim success for a no-op write.
    if (!entry || !n || n.caughtUp || n.season == null || n.episode == null) return
    markEpisode.mutate({ tvEntryId: entry.id, episodes: [{ season: n.season, episode: n.episode }], watchedOn: date })
  }

  // Movie fallback when there is no series in progress at all.
  const movieFallback = useMemo(() => {
    if (shows.length > 0) return null
    const m = movies.find(e => e.status === 'watching') ?? movies.find(e => e.status === 'wishlist')
    return m ? { title: m.movie.title, poster: m.movie.poster_path } : null
  }, [shows.length, movies])

  const n = next.data
  const series = entry?.tv_series

  function planNext() {
    if (!entry || !series || !n || n.caughtUp || n.season == null || n.episode == null) return
    modal.open({
      kind: 'time-block',
      config: { heading: 'Plan episode' },
      defaults: {
        title:    `${series.title} · S${pad(n.season)}E${pad(n.episode)}`,
        date,
        duration: 45,
        category: 'media',
        color:    'blue',
      },
      source: {
        sourceType: 'tv_episode',
        sourceId: entry.id,
        taskSourceType: 'tv_series',
        episodeInfo: { seasonNumber: n.season, episodeNumber: n.episode },
      },
    })
  }

  const poster = 'h-20 w-14 shrink-0 rounded-control border border-line object-cover'
  const posterEmpty = 'grid h-20 w-14 shrink-0 place-items-center rounded-control bg-surface-2 text-fg-faint'

  return (
    <Cell>
      <CellHeader icon={<Clapperboard />} title="Watch next" action={<CellLink to="/media">Browse</CellLink>} />

      {/* Show switcher — one chip per in-progress series */}
      {shows.length > 1 && (
        <div className="scroll-x flex gap-1.5 pb-0.5">
          {shows.map(s => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === entry?.id}
              onClick={() => setSelectedId(s.id)}
              className="pill-tab shrink-0"
            >
              {s.tv_series.title}
              {s.status === 'paused' && <Pause className="h-3 w-3" aria-label="Paused" />}
            </button>
          ))}
        </div>
      )}

      {entry && series ? (
        <div className="flex items-start gap-3">
          {series.poster_path ? (
            <img src={posterUrl(series.poster_path, 'w154')} alt="" className={poster} />
          ) : (
            <div className={posterEmpty}><Tv className="h-5 w-5" aria-hidden /></div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-ui font-semibold text-fg">{series.title}</p>
            {next.isLoading ? (
              <p className="mt-0.5 text-meta text-fg-muted">Finding next episode…</p>
            ) : n?.caughtUp ? (
              <p data-tone="success" className="tone-text mt-0.5 text-meta">All caught up ({n.watchedCount} watched)</p>
            ) : n ? (
              <>
                <p className="mt-0.5 text-body text-fg-2">
                  Next: <strong className="tabular-nums">S{pad(n.season!)}·E{pad(n.episode!)}</strong>
                  {n.episodeTitle && <span className="text-fg-muted"> — {n.episodeTitle}</span>}
                </p>
                <p className="mt-0.5 text-meta tabular-nums text-fg-muted">
                  {n.watchedCount}{n.totalEpisodes ? `/${n.totalEpisodes}` : ''} watched
                  {n.lastWatched && ` · last S${pad(n.lastWatched.season)}·E${pad(n.lastWatched.episode)}`}
                </p>
                {n.airDate && !n.released && (
                  <TonePill tone="warn" className="mt-1">
                    Airs {fmtDateEnGB(new Date(n.airDate), { day: 'numeric', month: 'short' })}
                  </TonePill>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button size="sm" icon={<Check />} onClick={markNextWatched} disabled={!n.released} loading={markEpisode.isPending}>
                    Watched
                  </Button>
                  <Button size="sm" variant="ghost" icon={<CalendarPlus />} onClick={planNext} disabled={!n.released}>
                    Plan
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : movieFallback ? (
        <Link to="/media" className="group flex items-center gap-3">
          {movieFallback.poster ? (
            <img src={posterUrl(movieFallback.poster, 'w154')} alt="" className={poster} />
          ) : (
            <div className={posterEmpty}><Clapperboard className="h-5 w-5" aria-hidden /></div>
          )}
          <div className="min-w-0">
            <p className="section-label">Movie</p>
            <p className="line-clamp-2 text-ui font-semibold text-fg transition-colors group-hover:text-accent-600">
              {movieFallback.title}
            </p>
          </div>
        </Link>
      ) : (
        <Link to="/media" className="flex min-h-[44px] items-center text-body text-fg-muted hover:text-accent-600">
          Nothing in progress — find something
        </Link>
      )}
    </Cell>
  )
}
