import { posterUrl, tmdbTVUrl } from '../../../integrations/tmdb/client'
import type { UserTVEntry } from '../types'
import { useUpdateTV } from '../hooks/useTVSeries'
import { PlanThisButton } from './PlanThisButton'

interface Props {
  entry: UserTVEntry
  compact?: boolean
  onOpenDetail?: () => void
}

const isUpcoming = (firstAirDate: string | null): boolean => {
  if (!firstAirDate) return true
  return new Date(firstAirDate) > new Date()
}

const STATUS_LABELS: Record<UserTVEntry['status'], string> = {
  watching:  'Watching',
  wishlist:  'Wishlist',
  completed: 'Completed',
  dropped:   'Dropped',
  paused:    'Paused',
}

function BingeProgress({ entry }: { entry: UserTVEntry }) {
  const { tv_series: s } = entry
  const totalEps     = s.number_of_episodes ?? 0
  const seasons      = s.number_of_seasons  ?? 1
  const avgPerSeason = seasons > 0 ? Math.ceil(totalEps / seasons) : totalEps
  const watchedEst   = (entry.current_season - 1) * avgPerSeason + entry.current_episode
  const remaining    = Math.max(0, totalEps - watchedEst)
  const pct          = totalEps > 0 ? Math.min(100, Math.round((watchedEst / totalEps) * 100)) : 0
  const hoursLeft    = Math.round(remaining * (s.episode_run_time ?? 30) / 60)

  return (
    <div className="mt-1">
      <div className="w-full h-1 rounded-full bg-ink-100 overflow-hidden">
        <div className="h-full bg-accent-400 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[9px] text-ink-400 mt-0.5">
        {remaining}ep · ~{hoursLeft}h left
      </p>
    </div>
  )
}

export function TVCard({ entry, compact, onOpenDetail }: Props) {
  const { tv_series: series } = entry
  const upcoming = isUpcoming(series.first_air_date)
  const update   = useUpdateTV()

  function advanceEpisode(e: React.MouseEvent) {
    e.stopPropagation()
    const seasons      = series.number_of_seasons  ?? 1
    const totalEps     = series.number_of_episodes ?? 999
    // Approximate episodes per season — TMDB doesn't give per-season counts in list views
    const epsPerSeason = Math.ceil(totalEps / seasons)
    const nextEp       = entry.current_episode + 1

    if (nextEp > epsPerSeason && entry.current_season < seasons) {
      update.mutate({ id: entry.id, patch: { current_season: entry.current_season + 1, current_episode: 1 } })
    } else if (nextEp > epsPerSeason && entry.current_season >= seasons) {
      update.mutate({ id: entry.id, patch: { status: 'completed', finished_at: new Date().toISOString() } })
    } else {
      update.mutate({ id: entry.id, patch: { current_episode: nextEp } })
    }
  }

  function markSeriesDone(e: React.MouseEvent) {
    e.stopPropagation()
    update.mutate({ id: entry.id, patch: { status: 'completed', finished_at: new Date().toISOString() } })
  }

  return (
    <div className="flex flex-col">
      <div
        className={`relative rounded-lg overflow-hidden aspect-[2/3] cursor-pointer transition-all duration-150 group ${upcoming ? 'grayscale' : ''}`}
        onClick={onOpenDetail}
      >
        <img
          src={posterUrl(series.poster_path)}
          alt={series.title}
          className="w-full h-full object-cover group-hover:brightness-75 transition-all duration-150"
          loading="lazy"
        />
        {upcoming && (
          <div className="absolute bottom-0 inset-x-0 flex justify-center pb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-accent-300 bg-black/60 px-1.5 py-0.5 rounded">
              Upcoming
            </span>
          </div>
        )}
        {entry.status === 'watching' && !upcoming && (
          <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded z-10">
            S{entry.current_season} E{entry.current_episode}
          </div>
        )}

        {/* Hover overlay — desktop only */}
        {!upcoming && entry.status !== 'completed' && (
          <div className="absolute inset-0 hidden md:flex flex-col items-center justify-end pb-2 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
            <div onClick={e => e.stopPropagation()} className="w-full px-2">
              <PlanThisButton
                entryId={entry.id}
                sourceType="tv_series"
                title={series.title}
                currentSeason={entry.current_season}
                currentEpisode={entry.current_episode}
              />
            </div>
            {entry.status === 'watching' && (
              <div className="flex gap-1 w-[calc(100%-16px)]">
                <button
                  onClick={advanceEpisode}
                  disabled={update.isPending}
                  className="flex-1 text-[10px] py-1 rounded bg-accent-500 text-white font-medium hover:bg-accent-600 transition-colors duration-150"
                >
                  + Next ep
                </button>
                <button
                  onClick={markSeriesDone}
                  disabled={update.isPending}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors duration-150"
                  title="Mark series as completed"
                >
                  ✓
                </button>
              </div>
            )}
            <a
              href={tmdbTVUrl(series.tmdb_id)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="text-[10px] text-white/60 hover:text-white transition-colors duration-150"
            >
              TMDB ↗
            </a>
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-1.5 px-0.5">
          <p className="text-xs font-medium text-ink-800 leading-snug truncate">{series.title}</p>
          <div className="flex items-center justify-between mt-0.5">
            {entry.rating ? (
              <span className="text-[10px] text-accent-500 font-medium">★ {entry.rating}/10</span>
            ) : series.tmdb_rating ? (
              <span className="text-[10px] text-ink-400">★ {series.tmdb_rating.toFixed(1)}</span>
            ) : null}
            <span className="text-[10px] text-ink-400">{STATUS_LABELS[entry.status]}</span>
          </div>
          {(entry.status === 'watching' || entry.status === 'paused') && series.number_of_episodes && (
            <BingeProgress entry={entry} />
          )}

          {/* Mobile-only action row — tap targets for touch devices */}
          {!upcoming && entry.status !== 'completed' && (
            <div className="flex gap-1 mt-1.5 md:hidden">
              <div className="flex-1 min-w-0">
                <PlanThisButton
                  entryId={entry.id}
                  sourceType="tv_series"
                  title={series.title}
                  currentSeason={entry.current_season}
                  currentEpisode={entry.current_episode}
                />
              </div>
              {entry.status === 'watching' && (
                <>
                  <button
                    onClick={advanceEpisode}
                    disabled={update.isPending}
                    className="min-h-[44px] px-2 text-[10px] rounded bg-accent-500 text-white font-medium hover:bg-accent-600 transition-colors duration-150 flex-shrink-0"
                  >
                    +ep
                  </button>
                  <button
                    onClick={markSeriesDone}
                    disabled={update.isPending}
                    className="min-h-[44px] px-2 text-[10px] rounded bg-emerald-500 text-white hover:bg-emerald-600 transition-colors duration-150 flex-shrink-0"
                    title="Mark series as completed"
                  >
                    ✓
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
