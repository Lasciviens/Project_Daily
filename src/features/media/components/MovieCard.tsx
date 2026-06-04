import { posterUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry } from '../types'
import { useUpdateMovie } from '../hooks/useMovies'

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
  return new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export function MovieCard({ entry, compact, onOpenDetail }: Props) {
  const { movie } = entry
  const upcoming  = isUpcoming(movie.release_date)
  const update    = useUpdateMovie()

  return (
    <div className="flex flex-col">
      <div
        className={`relative rounded-lg overflow-hidden aspect-[2/3] hover:brightness-90 cursor-pointer transition-all duration-150 ${upcoming ? 'grayscale' : ''}`}
        onClick={onOpenDetail}
      >
        <img
          src={posterUrl(movie.poster_path)}
          alt={movie.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {upcoming && (
          // Diagonal ribbon across top-right corner
          <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden pointer-events-none">
            <div className="absolute top-3 right-[-28px] rotate-45 w-24 text-center bg-accent-500 py-0.5">
              <span className="text-[8px] font-bold uppercase tracking-wider text-white">
                UPCOMING
              </span>
            </div>
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-1.5 px-0.5">
          <p className="text-xs font-medium text-ink-800 leading-snug truncate">{movie.title}</p>
          <p className={`text-[10px] mt-0.5 ${upcoming ? 'text-accent-500' : 'text-ink-400'}`}>
            {formatReleaseDate(movie.release_date)}
          </p>
          <div className="flex items-center justify-between mt-0.5">
            {movie.tmdb_rating && (
              <span className="text-[10px] text-ink-400">★ {movie.tmdb_rating.toFixed(1)}</span>
            )}
            <span className="text-[10px] text-ink-400">{STATUS_LABELS[entry.status]}</span>
          </div>
          {entry.status === 'watching' && (
            <button
              onClick={() => update.mutate({ id: entry.id, patch: { status: 'completed', watched_at: new Date().toISOString() } })}
              disabled={update.isPending}
              className="mt-1 w-full text-[10px] py-0.5 rounded border border-accent-300 text-accent-600 hover:bg-accent-50 transition-colors duration-150"
            >
              Mark watched
            </button>
          )}
        </div>
      )}
    </div>
  )
}
