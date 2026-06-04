import { posterUrl, tmdbMovieUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry } from '../types'
import { PlanThisButton } from './PlanThisButton'
import { useDeleteMovie, useUpdateMovie } from '../hooks/useMovies'

interface Props {
  entry: UserMovieEntry
  compact?: boolean
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

export function MovieCard({ entry, compact }: Props) {
  const { movie } = entry
  const upcoming  = isUpcoming(movie.release_date)
  const remove    = useDeleteMovie()
  const update    = useUpdateMovie()

  return (
    <div className="group relative flex flex-col">
      {/* Poster */}
      <div className={`relative rounded-lg overflow-hidden aspect-[2/3] ${upcoming ? 'grayscale' : ''}`}>
        <img
          src={posterUrl(movie.poster_path)}
          alt={movie.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />

        {upcoming && (
          <div className="absolute inset-0 flex flex-col items-center justify-end p-2 bg-gradient-to-t from-black/70">
            <span className="text-[9px] font-bold uppercase tracking-wider text-amber-300 bg-black/60 px-1.5 py-0.5 rounded">
              Upcoming
            </span>
            {movie.release_date && (
              <span className="text-[9px] text-white/80 mt-0.5">
                {new Date(movie.release_date).getFullYear()}
              </span>
            )}
          </div>
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex flex-col items-center justify-center gap-2 p-2">
          <PlanThisButton entryId={entry.id} sourceType="movie" title={movie.title} />
          <a
            href={tmdbMovieUrl(movie.tmdb_id)}
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

      {/* Title + rating */}
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
