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
          <div className="absolute bottom-0 inset-x-0 flex justify-center pb-2">
            <span className="text-[9px] font-bold uppercase tracking-wider text-accent-300 bg-black/60 px-1.5 py-0.5 rounded">
              Upcoming
            </span>
          </div>
        )}
      </div>

      {!compact && (
        <div className="mt-1.5 px-0.5">
          <p className="text-xs font-medium text-ink-800 leading-snug truncate">{movie.title}</p>
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
