import { useState } from 'react'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { TMDBMovie, TMDBTVSeries, MediaStatus } from '../types'

interface Props {
  item: TMDBMovie | TMDBTVSeries | null
  mediaType: 'movie' | 'tv'
  onConfirm: (status: MediaStatus) => void
  onClose: () => void
  isPending?: boolean
}

const MOVIE_STATUSES: { value: MediaStatus; label: string }[] = [
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'watching',  label: 'Watching' },
  { value: 'completed', label: 'Completed' },
]

const TV_STATUSES: { value: MediaStatus; label: string }[] = [
  { value: 'wishlist',  label: 'Wishlist' },
  { value: 'watching',  label: 'Watching' },
  { value: 'paused',    label: 'Paused' },
  { value: 'completed', label: 'Completed' },
]

function isMovie(item: TMDBMovie | TMDBTVSeries): item is TMDBMovie {
  return 'title' in item
}

export function AddMediaConfirm({ item, mediaType, onConfirm, onClose, isPending }: Props) {
  const [status, setStatus] = useState<MediaStatus>('wishlist')

  if (!item) return null

  const title    = isMovie(item) ? item.title : item.name
  const year     = isMovie(item)
    ? item.release_date?.slice(0, 4)
    : (item as TMDBTVSeries).first_air_date?.slice(0, 4)
  const statuses = mediaType === 'movie' ? MOVIE_STATUSES : TV_STATUSES

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="card p-5 w-full max-w-sm mx-4 flex gap-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Poster */}
        <img
          src={posterUrl(item.poster_path, 'w185')}
          alt={title}
          className="w-16 flex-shrink-0 rounded-md object-cover"
        />

        {/* Details */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink-900 leading-snug">{title}</p>
          {year && <p className="text-xs text-ink-400 mt-0.5">{year}</p>}

          <p className="text-xs text-ink-500 mt-3 mb-2">Add to:</p>
          <div className="flex flex-wrap gap-1.5">
            {statuses.map(s => (
              <button
                key={s.value}
                onClick={() => setStatus(s.value)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors duration-150 ${
                  status === s.value
                    ? 'bg-accent-500 border-accent-500 text-white'
                    : 'border-ink-200 text-ink-600 hover:border-accent-400'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => onConfirm(status)}
              disabled={isPending}
              className="btn-primary flex-1 text-sm py-1.5"
            >
              {isPending ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={onClose}
              className="flex-1 text-sm py-1.5 rounded-lg border border-ink-200 text-ink-600 hover:bg-cream-100 transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
