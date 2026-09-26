import type { EntityModalProps } from '../../../shared/modals/types'
import { entityModal } from '../../../shared/modals/useEntityModal'
import { MediaDetailModal } from '../components/MediaDetailModal'
import { useMovieEntryByTmdb } from '../hooks/useMovies'
import { useTVEntryByTmdb } from '../hooks/useTVSeries'

/**
 * `media`: a movie or series detail by TMDB id. The user's own library entry
 * (status, rating, note, progress) is read live from the library lists, so any
 * page can open the same popup with nothing but the id. A "similar" title
 * opens as a new popup on top.
 */
export function MediaEntityModal({ request, onClose }: EntityModalProps<'media'>) {
  const { tmdbId, mediaType } = request
  const movie = useMovieEntryByTmdb(tmdbId, mediaType === 'movie')
  const tv = useTVEntryByTmdb(tmdbId, mediaType === 'tv')
  const userEntry = mediaType === 'movie' ? movie.data : tv.data
  return (
    <MediaDetailModal
      tmdbId={tmdbId}
      mediaType={mediaType}
      userEntry={userEntry ?? null}
      onClose={onClose}
      onOpenDetail={(id, type) => entityModal.open({ kind: 'media', tmdbId: id, mediaType: type })}
    />
  )
}
