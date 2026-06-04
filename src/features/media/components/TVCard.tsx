import { posterUrl, tmdbTVUrl } from '../../../integrations/tmdb/client'
import type { UserTVEntry } from '../types'
import { PlanThisButton } from './PlanThisButton'
import { useDeleteTV, useUpdateTV } from '../hooks/useTVSeries'

interface Props {
  entry: UserTVEntry
  compact?: boolean
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

export function TVCard({ entry, compact }: Props) {
  const { tv_series: series } = entry
  const upcoming = isUpcoming(series.first_air_date)
  const remove   = useDeleteTV()
  const update   = useUpdateTV()

  function advanceEpisode() {
    const maxEp = series.number_of_episodes ?? 999
    const ep    = entry.current_episode + 1
    update.mutate({ id: entry.id, patch: { current_episode: ep > maxEp ? 0 : ep } })
  }

  return (
    <div className="group relative flex flex-col">
      {/* Poster */}
      <div className={`relative rounded-lg overflow-hidden aspect-[2/3] ${upcoming ? 'grayscale' : ''}`}>
        <img
          src={posterUrl(series.poster_path)}
          alt={series.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />

        {upcoming && (
          <div className="absolute inset-0 flex flex-col items-center justify-end p-2 bg-gradient-to-t from-black/70">
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-black/60 px-1.5 py-0.5 rounded">
              Upcoming
            </span>
            {series.first_air_date && (
              <span className="text-[9px] text-white/80 mt-0.5">
                {new Date(series.first_air_date).getFullYear()}
              </span>
            )}
          </div>
        )}

        {/* Episode badge */}
        {entry.status === 'watching' && !upcoming && (
          <div className="absolute top-1.5 left-1.5 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
            S{entry.current_season} E{entry.current_episode}
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex flex-col items-center justify-center gap-2 p-2">
          <PlanThisButton
            entryId={entry.id}
            sourceType="tv_series"
            title={series.title}
            currentSeason={entry.current_season}
            currentEpisode={entry.current_episode}
          />
          <a
            href={tmdbTVUrl(series.tmdb_id)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-white/80 hover:text-white transition-colors duration-150"
            onClick={e => e.stopPropagation()}
          >
            TMDB ↗
          </a>
          <button
            onClick={() => remove.mutate(entry.id)}
            disabled={remove.isPending}
            className="text-[10px] text-red-400 hover:text-red-300 transition-colors duration-150"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Title + progress */}
      {!compact && (
        <div className="mt-1.5 px-0.5">
          <p className="text-xs font-medium text-ink-800 leading-snug truncate">{series.title}</p>
          <div className="flex items-center justify-between mt-0.5">
            {series.tmdb_rating && (
              <span className="text-[10px] text-ink-400">★ {series.tmdb_rating.toFixed(1)}</span>
            )}
            <span className="text-[10px] text-ink-400">{STATUS_LABELS[entry.status]}</span>
          </div>
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
