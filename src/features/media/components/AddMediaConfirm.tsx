import { useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
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

  const title    = item && isMovie(item) ? item.title : item?.name ?? ''
  const year     = item
    ? (isMovie(item)
        ? item.release_date?.slice(0, 4)
        : (item as TMDBTVSeries).first_air_date?.slice(0, 4))
    : undefined
  const statuses = mediaType === 'movie' ? MOVIE_STATUSES : TV_STATUSES

  return (
    <Dialog open={item !== null} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-900/30 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-sm max-h-[90vh] overflow-y-auto bg-white border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="p-4">
            {item && (
              <>
                {/* Poster + title row */}
                <div className="flex gap-3 mb-3">
                  <img
                    src={posterUrl(item.poster_path, 'w185')}
                    alt={title}
                    className="w-14 flex-shrink-0 rounded-md object-cover"
                  />
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-sm font-semibold text-ink-900 leading-snug">{title}</p>
                    {year && <p className="text-xs text-ink-400 mt-0.5">{year}</p>}
                  </div>
                </div>

                <p className="text-xs text-ink-500 mb-2">Add to:</p>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {statuses.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setStatus(s.value)}
                      className={`text-xs px-3 min-h-[44px] rounded-full border transition-colors duration-150 ${
                        status === s.value
                          ? 'bg-accent-500 border-accent-500 text-white'
                          : 'border-ink-200 text-ink-600 hover:border-accent-400'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => onConfirm(status)}
                    disabled={isPending}
                    className="btn-primary flex-1 text-sm min-h-[44px]"
                  >
                    {isPending ? 'Adding…' : 'Add'}
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 text-sm min-h-[44px] rounded-lg border border-ink-200 text-ink-600 hover:bg-cream-100 transition-colors duration-150"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
