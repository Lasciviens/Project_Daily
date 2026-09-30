import { useEffect, useRef, useState } from 'react'
import type { EntityModalProps } from '../../../shared/modals/types'
import { useHistoryDismiss } from '../../../shared/hooks/useHistoryDismiss'
import { MediaDetailModal } from '../components/MediaDetailModal'
import { useMovieEntryByTmdb } from '../hooks/useMovies'
import { useTVEntryByTmdb } from '../hooks/useTVSeries'
import type { MediaType } from '../types'

interface Step { tmdbId: number; mediaType: MediaType }

/** One history entry per title opened inside the popup, so browser / mouse Back returns to the previous title. */
function BackStep({ onBack }: { onBack: () => void }) {
  useHistoryDismiss(true, onBack)
  return null
}

/**
 * `media`: a movie or series detail by TMDB id. The user's own library entry
 * (status, rating, note, progress) is read live from the library lists, so any
 * page can open the same popup with nothing but the id. A title opened from
 * inside it (the franchise strip, "More like this") replaces the content in
 * this same popup, and Back steps through the titles in order.
 */
export function MediaEntityModal({ request, onClose }: EntityModalProps<'media'>) {
  const [trail, setTrail] = useState<Step[]>([{ tmdbId: request.tmdbId, mediaType: request.mediaType }])
  const { tmdbId, mediaType } = trail[trail.length - 1]
  const closingAll = useRef(false)
  const fallback = useRef(0)
  useEffect(() => () => window.clearTimeout(fallback.current), [])

  const movie = useMovieEntryByTmdb(tmdbId, mediaType === 'movie')
  const tv = useTVEntryByTmdb(tmdbId, mediaType === 'tv')
  const userEntry = mediaType === 'movie' ? movie.data : tv.data

  const open = (id: number, type: MediaType) => {
    if (id === tmdbId && type === mediaType) return
    setTrail(t => [...t, { tmdbId: id, mediaType: type }])
  }
  // Closing (X, Esc, backdrop) with titles stacked: go back past every step
  // in one jump; the top step's Back then closes the popup, and the history
  // stays balanced (no dead Back entries left behind).
  const close = () => {
    const extra = trail.length - 1
    if (extra > 0 && !closingAll.current) {
      closingAll.current = true
      window.history.go(-extra)
      // If that traversal never reaches the top step (a pending own Back
      // swallowed it), close anyway rather than leave the popup half-closed.
      fallback.current = window.setTimeout(onClose, 600)
      return
    }
    onClose()
  }
  const onStepBack = () => {
    if (closingAll.current) onClose()
    else setTrail(t => t.slice(0, -1))
  }

  return (
    <>
      {trail.slice(1).map((_, i) => <BackStep key={i} onBack={onStepBack} />)}
      <MediaDetailModal
        tmdbId={tmdbId}
        mediaType={mediaType}
        userEntry={userEntry ?? null}
        onClose={close}
        onBack={trail.length > 1 ? () => window.history.back() : undefined}
        // Adding or removing finishes the task this popup was opened for; on a
        // title reached inside it, the popup stays on that title instead.
        onAdded={trail.length > 1 ? undefined : close}
        onOpenDetail={open}
      />
    </>
  )
}
