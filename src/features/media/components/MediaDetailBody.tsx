import { posterUrl } from '../../../integrations/tmdb/client'
import { SimilarRow } from './SimilarRow'
import { EpisodesPanel } from './EpisodesPanel'
import { MediaDetailInfo } from './MediaDetailInfo'
import { MediaLibraryControls } from './MediaLibraryControls'
import type { TMDBMovieFull, TMDBTVFull, UserMovieEntry, UserTVEntry, MediaType } from '../types'

interface Props {
  detail: TMDBMovieFull | TMDBTVFull
  mediaType: MediaType
  userEntry?: UserMovieEntry | UserTVEntry | null
  onAdded?: () => void
  onOpenDetail?: (id: number, type: MediaType) => void
}

export function MediaDetailBody({ detail, mediaType, userEntry, onAdded, onOpenDetail }: Props) {
  const isMovie = mediaType === 'movie'
  const tv = !isMovie ? (detail as TMDBTVFull) : null
  const tvEntryId = !isMovie && userEntry ? userEntry.id : null

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-5 md:flex-row">
      {/* The hero already shows the poster on phones. */}
      <img
        src={posterUrl(detail.poster_path, 'w342')}
        alt=""
        className="hidden w-32 shrink-0 self-start rounded-row bg-surface-2 object-cover md:block"
      />

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <MediaDetailInfo detail={detail} isMovie={isMovie} />

        <SimilarRow tmdbId={detail.id} mediaType={mediaType} onOpenDetail={(id, type) => onOpenDetail?.(id, type)} />

        {tv && tvEntryId && (tv.seasons?.length ?? 0) > 0 && <EpisodesPanel tv={tv} tvEntryId={tvEntryId} />}

        <div className="border-t border-line pt-4">
          <MediaLibraryControls detail={detail} isMovie={isMovie} userEntry={userEntry} onAdded={onAdded} />
        </div>
      </div>
    </div>
  )
}
