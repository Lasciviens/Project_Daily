import { useMovieFull, useTVFull } from '../hooks/useTMDB'
import { MediaDetailBody } from './MediaDetailBody'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Skeleton as Bone } from '../../../shared/ui'
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
    <div className="flex gap-4 p-5">
      <Bone rounded="rounded-card" className="aspect-[2/3] w-32 shrink-0" />
      <div className="flex-1 space-y-3">
        <Bone className="h-4 w-3/4" />
        <Bone className="h-3 w-full" />
        <Bone className="h-3 w-5/6" />
        <Bone className="h-3 w-2/3" />
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

  // The backdrop hero is the header (poster, title, rating); ModalShell floats
  // its close button over it. Phones: bottom sheet; sm+: centered dialog.
  return (
    <ModalShell
      open={tmdbId !== null}
      onClose={onClose}
      size="lg"
      bodyClassName=""
      hero={
        <div className="relative h-28 shrink-0 bg-surface-2 sm:h-48">
          {backdrop && <img src={backdrop} alt="" className="h-full w-full object-cover" />}
          <div className="absolute inset-0 bg-gradient-to-t from-scrim/80 via-scrim/20 to-transparent" />
          <div className="absolute bottom-0 left-0 p-4">
            <div className="flex items-end gap-3">
              {detail && <img src={posterUrl(detail.poster_path, 'w92')} alt="" className="w-10 shrink-0 rounded-md" />}
              <div>
                {title && <h2 className="text-title font-semibold leading-tight text-white">{title}</h2>}
                <div className="flex items-center gap-2 text-meta text-white/70 tabular-nums">
                  {year && <span>{year}</span>}
                  {detail?.vote_average ? <span>★ {detail.vote_average.toFixed(1)}</span> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    >
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
    </ModalShell>
  )
}
