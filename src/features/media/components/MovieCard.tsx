import { posterUrl, tmdbMovieUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry } from '../types'
import { useUpdateMovie } from '../hooks/useMovies'
import { PlanThisButton } from './PlanThisButton'

interface Props {
  entry: UserMovieEntry
  compact?: boolean
  onOpenDetail?: () => void
}

const isUpcoming = (releaseDate: string | null): boolean => {
  if (!releaseDate) return true
  return new Date(releaseDate) > new Date()
}

const STATUS_LABELS: Record<UserMovieEntry['status'], string> = {
  watching:  'Watching',
  wishlist:  'Wishlist',
  completed: 'Completed',
  dropped:   'Dropped',
}

function formatReleaseDate(date: string | null): string {
  if (!date) return 'TBA'
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function MovieCard({ entry, compact, onOpenDetail }: Props) {
  const { movie } = entry
  const upcoming  = isUpcoming(movie.release_date)
  const update    = useUpdateMovie()

  return (
    <div className="flex flex-col">
      <div
        className={`relative rounded-lg overflow-hidden aspect-[2/3] cursor-pointer transition-all duration-150 group ${upcoming ? 'grayscale' : ''}`}
        onClick={onOpenDetail}
      >
        <img
          src={posterUrl(movie.poster_path)}
          alt={movie.title}
          className="w-full h-full object-cover group-hover:brightness-75 transition-all duration-150"
          loading="lazy"
        />
        {upcoming && (
          <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden pointer-events-none">
            <div className="absolute top-3 right-[-28px] rotate-45 w-24 text-center bg-accent-500 py-0.5">
              <span className="text-[8px] font-bold uppercase tracking-wider text-white">
                UPCOMING
              </span>
            </div>
          </div>
        )}

        {/* Hover overlay with quick actions */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2 gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
          {!upcoming && entry.status !== 'completed' && (
            <div onClick={e => e.stopPropagation()} className="w-full px-2">
              <PlanThisButton
                entryId={entry.id}
                sourceType="movie"
                title={movie.title}
              />
            </div>
          )}
          {entry.status === 'watching' && (
            <button
              onClick={e => {
                e.stopPropagation()
                update.mutate({ id: entry.id, patch: { status: 'completed', watched_at: new Date().toISOString() } })
              }}
              disabled={update.isPending}
              className="w-[calc(100%-16px)] text-[10px] py-1 rounded bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors duration-150"
            >
              ✓ Mark watched
            </button>
          )}
          <a
            href={tmdbMovieUrl(movie.tmdb_id)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="text-[10px] text-white/60 hover:text-white transition-colors duration-150"
          >
            TMDB ↗
          </a>
        </div>
      </div>

      {!compact && (
        <div className="mt-1.5 px-0.5">
          <p className="text-xs font-medium text-ink-800 leading-snug truncate">{movie.title}</p>
          <p className={`text-[10px] mt-0.5 ${upcoming ? 'text-accent-500' : 'text-ink-400'}`}>
            {formatReleaseDate(movie.release_date)}
          </p>
          <div className="flex items-center justify-between mt-0.5">
            {entry.rating ? (
              <span className="text-[10px] text-accent-500 font-medium">★ {entry.rating}/10</span>
            ) : movie.tmdb_rating ? (
              <span className="text-[10px] text-ink-400">★ {movie.tmdb_rating.toFixed(1)}</span>
            ) : null}
            <span className="text-[10px] text-ink-400">{STATUS_LABELS[entry.status]}</span>
          </div>
        </div>
      )}
    </div>
  )
}
