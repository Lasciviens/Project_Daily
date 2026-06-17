import { useEffect } from 'react'
import { useMovieFull, useTVFull } from '../hooks/useTMDB'
import { MediaDetailBody } from './MediaDetailBody'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { UserMovieEntry, UserTVEntry } from '../types'

interface Props {
  tmdbId: number | null
  mediaType: 'movie' | 'tv'
  userEntry?: UserMovieEntry | UserTVEntry | null
  onClose: () => void
  onAdded?: () => void
  onOpenDetail?: (id: number, type: 'movie' | 'tv') => void
}

function Skeleton() {
  return (
    <div className="p-5 flex gap-4">
      <div className="w-32 aspect-[2/3] rounded-xl bg-cream-200 animate-pulse flex-shrink-0" />
      <div className="flex-1 space-y-3">
        <div className="h-4 bg-cream-200 animate-pulse rounded w-3/4" />
        <div className="h-3 bg-cream-200 animate-pulse rounded w-full" />
        <div className="h-3 bg-cream-200 animate-pulse rounded w-5/6" />
        <div className="h-3 bg-cream-200 animate-pulse rounded w-2/3" />
      </div>
    </div>
  )
}

export function MediaDetailModal({ tmdbId, mediaType, userEntry, onClose, onAdded, onOpenDetail }: Props) {
  const { data: movieFull, isLoading: movieLoading } = useMovieFull(mediaType === 'movie' ? tmdbId : null)
  const { data: tvFull,    isLoading: tvLoading    } = useTVFull(mediaType === 'tv' ? tmdbId : null)

  const detail  = mediaType === 'movie' ? movieFull : tvFull
  const loading = mediaType === 'movie' ? movieLoading : tvLoading

  const title = detail
    ? (mediaType === 'movie' ? (detail as typeof movieFull)!.title : (detail as typeof tvFull)!.name)
    : ''
  const year = detail
    ? (mediaType === 'movie'
        ? (detail as typeof movieFull)!.release_date?.slice(0, 4)
        : (detail as typeof tvFull)!.first_air_date?.slice(0, 4))
    : ''

  const backdrop = detail?.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${detail.backdrop_path}`
    : null

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (tmdbId === null) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start justify-center overflow-y-auto py-8 px-4"
      onClick={onClose}
    >
      <div
        className="max-w-3xl w-full rounded-2xl overflow-hidden bg-white max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Backdrop header */}
        <div className="relative h-48 flex-shrink-0 bg-ink-200">
          {backdrop && (
            <img
              src={backdrop}
              alt=""
              className="w-full h-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 w-11 h-11 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors duration-150 text-sm"
            aria-label="Close"
          >
            ×
          </button>
          <div className="absolute bottom-0 left-0 p-4">
            <div className="flex items-end gap-3">
              {detail && (
                <img
                  src={posterUrl(detail.poster_path, 'w92')}
                  alt={title}
                  className="w-10 rounded-md flex-shrink-0"
                />
              )}
              <div>
                {title && <h2 className="text-white font-semibold text-lg leading-tight">{title}</h2>}
                <div className="flex items-center gap-2 text-white/70 text-xs">
                  {year && <span>{year}</span>}
                  {detail?.vote_average ? <span>★ {detail.vote_average.toFixed(1)}</span> : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {loading || !detail ? (
            <Skeleton />
          ) : (
            <MediaDetailBody
              detail={detail}
              mediaType={mediaType}
              userEntry={userEntry}
              onAdded={onAdded}
              onOpenDetail={onOpenDetail}
            />
          )}
        </div>
      </div>
    </div>
  )
}
