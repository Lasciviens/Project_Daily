import { posterUrl } from '../../../integrations/tmdb/client'
import type { UserTVEntry } from '../types'
import { useUpdateTV } from '../hooks/useTVSeries'

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
    const maxEp = series.number_of_episodes ?? 999
    const ep    = entry.current_episode + 1
    update.mutate({ id: entry.id, patch: { current_episode: ep > maxEp ? 0 : ep } })
  }

  return (
    <div className="flex flex-col">
      <div
        className={`relative rounded-lg overflow-hidden aspect-[2/3] hover:brightness-90 cursor-pointer transition-all duration-150 ${upcoming ? 'grayscale' : ''}`}
        onClick={onOpenDetail}
      >
        <img
          src={posterUrl(series.poster_path)}
          alt={series.title}
          className="w-full h-full object-cover"
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
          <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
            S{entry.current_season} E{entry.current_episode}
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-1.5 px-0.5">
          <p className="text-xs font-medium text-ink-800 leading-snug truncate">{series.title}</p>
          <div className="flex items-center justify-between mt-0.5">
            {series.tmdb_rating && (
              <span className="text-[10px] text-ink-400">★ {series.tmdb_rating.toFixed(1)}</span>
            )}
            <span className="text-[10px] text-ink-400">{STATUS_LABELS[entry.status]}</span>
          </div>
          {/* Binge calculator: show remaining episodes + estimated hours */}
          {(entry.status === 'watching' || entry.status === 'paused') && series.number_of_episodes && (
            <BingeProgress entry={entry} />
          )}
          {entry.status === 'watching' && (
            <button
              onClick={advanceEpisode}
              disabled={update.isPending}
              className="mt-1 w-full text-[10px] py-0.5 rounded border border-accent-300 text-accent-600 hover:bg-accent-50 transition-colors duration-150"
            >
              + Next episode
            </button>
          )}
        </div>
      )}
    </div>
  )
}
