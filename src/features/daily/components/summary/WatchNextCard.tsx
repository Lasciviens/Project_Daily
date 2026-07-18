import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Cell, CellHeader, CellLink } from './cellKit'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMovies } from '../../../media/hooks/useMovies'
import { useTVSeries } from '../../../media/hooks/useTVSeries'
import { useNextEpisode } from '../../../media/hooks/useNextEpisode'
import { markEpisodeWatched } from '../../../media/api/watchedEpisodesApi'
import { UnifiedPlanModal } from '../../../../shared/components/plan-modal'
import { posterUrl } from '../../../../integrations/tmdb/client'
import { toast } from '../../../../app/store'

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
  const qc = useQueryClient()

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
  const [planOpen, setPlanOpen] = useState(false)

  const markWatched = useMutation({
    mutationFn: async () => {
      const n = next.data
      if (!entry || !n || n.caughtUp || n.season == null || n.episode == null) return
      await markEpisodeWatched(entry.id, n.season, n.episode, date)
    },
    onSuccess: () => {
      toast.success('Marked watched ✓')
      qc.invalidateQueries({ queryKey: ['next-episode'] })
      qc.invalidateQueries({ queryKey: ['watched-episodes'] })
      qc.invalidateQueries({ queryKey: ['tv'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
    onError: (e) => toast.error((e as Error).message ?? 'Failed'),
  })

  // Movie fallback when there is no series in progress at all.
  const movieFallback = useMemo(() => {
    if (shows.length > 0) return null
    const m = movies.find(e => e.status === 'watching') ?? movies.find(e => e.status === 'wishlist')
    return m ? { title: m.movie.title, poster: m.movie.poster_path } : null
  }, [shows.length, movies])

  const n = next.data
  const series = entry?.tv_series

  return (
    <Cell>
      <CellHeader icon="🎬" title="Watch next" action={<CellLink to="/media">Browse →</CellLink>} />

      {/* Show switcher — one chip per in-progress series */}
      {shows.length > 1 && (
        <div className="flex gap-1 overflow-x-auto scrollbar-none pb-0.5">
          {shows.map(s => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              className={`shrink-0 text-[10px] px-2 py-1 rounded-full border transition-colors min-h-[24px] ${
                s.id === entry?.id
                  ? 'bg-accent-500 text-white border-accent-500'
                  : 'text-ink-500 border-ink-200 hover:border-accent-300'
              }`}>
              {s.tv_series.title}{s.status === 'paused' ? ' ⏸' : ''}
            </button>
          ))}
        </div>
      )}

      {entry && series ? (
        <div className="flex items-start gap-3">
          {series.poster_path ? (
            <img src={posterUrl(series.poster_path, 'w154')} alt={series.title}
              className="w-14 h-20 object-cover rounded-lg shrink-0 border border-ink-100" />
          ) : (
            <div className="w-14 h-20 rounded-lg bg-cream-200 flex items-center justify-center text-2xl shrink-0">📺</div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-800 truncate">{series.title}</p>
            {next.isLoading ? (
              <p className="text-[11px] text-ink-400 mt-0.5">Finding next episode…</p>
            ) : n?.caughtUp ? (
              <p className="text-[11px] text-green-600 mt-0.5">All caught up ✓ ({n.watchedCount} watched)</p>
            ) : n ? (
              <>
                <p className="text-xs text-ink-700 mt-0.5">
                  Next: <strong>S{pad(n.season!)}·E{pad(n.episode!)}</strong>
                  {n.episodeTitle && <span className="text-ink-500"> — {n.episodeTitle}</span>}
                </p>
                <p className="text-[10px] text-ink-400 mt-0.5">
                  {n.watchedCount}{n.totalEpisodes ? `/${n.totalEpisodes}` : ''} watched
                  {n.lastWatched && ` · last S${pad(n.lastWatched.season)}·E${pad(n.lastWatched.episode)}`}
                </p>
                {n.airDate && !n.released && (
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    Airs {new Date(n.airDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </p>
                )}
                <div className="flex gap-1.5 mt-1.5">
                  <button
                    onClick={() => markWatched.mutate()}
                    disabled={markWatched.isPending || !n.released}
                    className="text-[11px] px-2 py-1 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 transition-colors disabled:opacity-40 min-h-[28px]"
                  >
                    ✓ Watched
                  </button>
                  <button
                    onClick={() => setPlanOpen(true)}
                    disabled={!n.released}
                    className="text-[11px] px-2 py-1 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 transition-colors disabled:opacity-40 min-h-[28px]"
                  >
                    📅 Plan
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : movieFallback ? (
        <Link to="/media" className="flex items-center gap-3 group">
          {movieFallback.poster ? (
            <img src={posterUrl(movieFallback.poster, 'w154')} alt={movieFallback.title}
              className="w-14 h-20 object-cover rounded-lg shrink-0 border border-ink-100" />
          ) : (
            <div className="w-14 h-20 rounded-lg bg-cream-200 flex items-center justify-center text-2xl shrink-0">🎬</div>
          )}
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-ink-400">Movie</p>
            <p className="text-sm font-semibold text-ink-800 group-hover:text-accent-700 transition-colors line-clamp-2">
              {movieFallback.title}
            </p>
          </div>
        </Link>
      ) : (
        <Link to="/media" className="text-xs text-accent-600 hover:text-accent-700 py-2">
          Nothing in progress — find something →
        </Link>
      )}

      {entry && series && n && !n.caughtUp && n.season != null && n.episode != null && (
        <UnifiedPlanModal
          open={planOpen}
          onClose={() => setPlanOpen(false)}
          config={{ tabs: ['schedule'], heading: 'Plan episode' }}
          defaults={{
            title:    `📺 ${series.title} · S${pad(n.season)}E${pad(n.episode)}`,
            date,
            duration: 45,
            category: 'media',
            color:    'blue',
          }}
          source={{
            sourceType: 'tv_episode',
            sourceId: entry.id,
            taskSourceType: 'tv_series',
            episodeInfo: { seasonNumber: n.season, episodeNumber: n.episode },
          }}
        />
      )}
    </Cell>
  )
}
