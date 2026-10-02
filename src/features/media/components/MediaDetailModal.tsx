import { useEffect, useRef, type TouchEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMovieFull, useTVFull } from '../hooks/useTMDB'
import { MediaDetailBody } from './MediaDetailBody'
import { ModalShell } from '../../../shared/modals/ModalShell'
import { Button, Skeleton as Bone } from '../../../shared/ui'
import { posterUrl } from '../../../integrations/tmdb/client'
import type { MediaType, UserMovieEntry, UserTVEntry, OpenMediaDetail } from '../types'

interface Props {
  tmdbId: number
  mediaType: MediaType
  userEntry?: UserMovieEntry | UserTVEntry | null
  onClose: () => void
  onRemoved?: () => void
  onOpenDetail?: OpenMediaDetail
  /** Shown when titles were opened inside this popup: back to the previous one. */
  onBack?: () => void
  /** Previous / next title of the list this popup was opened from. */
  nav?: { position: number; total: number; onPrev?: () => void; onNext?: () => void }
}

const NAV_BTN = 'absolute bottom-3 z-10 grid h-11 w-11 place-items-center sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 rounded-full bg-scrim/55 text-white backdrop-blur-sm transition-colors hover:bg-scrim/80 disabled:pointer-events-none disabled:opacity-0'

/** Hero height; MediaDetailBody's sticky rail subtracts it to fit under it. */
const HERO_H = 'h-36 sm:h-56'

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

export function MediaDetailModal({ tmdbId, mediaType, userEntry, onClose, onRemoved, onOpenDetail, onBack, nav }: Props) {
  // Phones: both arrows sit bottom-right, clear of the close button; sm+: one on each side.
  // ← / → step through the list, except while typing (the note, a date).
  const navRef = useRef(nav)
  useEffect(() => { navRef.current = nav })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || t?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'ArrowLeft' && navRef.current?.onPrev) { e.preventDefault(); navRef.current.onPrev() }
      if (e.key === 'ArrowRight' && navRef.current?.onNext) { e.preventDefault(); navRef.current.onNext() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  // A horizontal swipe on the picture does the same on a touch screen.
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const onSwipeStart = (e: TouchEvent) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY } }
  const onSwipeEnd = (e: TouchEvent) => {
    const start = swipe.current
    swipe.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    const dx = t.clientX - start.x
    const dy = t.clientY - start.y
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    if (dx > 0) navRef.current?.onPrev?.()
    else navRef.current?.onNext?.()
  }
  // A new title in the same popup starts at its top.
  const top = useRef<HTMLDivElement>(null)
  useEffect(() => { top.current?.parentElement?.scrollTo({ top: 0 }) }, [tmdbId, mediaType])
  const movieQ = useMovieFull(mediaType === 'movie' ? tmdbId : null)
  const tvQ    = useTVFull(mediaType === 'tv' ? tmdbId : null)
  const query = mediaType === 'movie' ? movieQ : tvQ
  const detail = query.data

  const title = movieQ.data?.title ?? tvQ.data?.name ?? ''
  const year = (movieQ.data?.release_date ?? tvQ.data?.first_air_date)?.slice(0, 4) ?? ''

  const backdrop = detail?.backdrop_path
    ? `https://image.tmdb.org/t/p/w780${detail.backdrop_path}`
    : null

  // The backdrop hero is the header (poster, title, rating); ModalShell floats
  // its close button over it. Phones: bottom sheet; sm+: centered dialog.
  return (
    <ModalShell
      onClose={onClose}
      size="xl"
      bodyClassName=""
      hero={
        <div className={`relative ${HERO_H} shrink-0 bg-scrim`} onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
          {backdrop && <img src={backdrop} alt="" className="h-full w-full object-cover object-[center_25%]" />}
          {/* The picture loses its light from top to bottom: 90 % at the top, none at the bottom edge. */}
          <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgb(var(--scrim)/0.1)_0%,rgb(var(--scrim)/0.45)_55%,rgb(var(--scrim)/1)_100%)]" />
          {nav && (
            <>
              <button type="button" onClick={nav.onPrev} disabled={!nav.onPrev} aria-label="Previous title" className={`${NAV_BTN} right-14 sm:left-2 sm:right-auto`}>
                <ChevronLeft aria-hidden className="h-5 w-5" />
              </button>
              <button type="button" onClick={nav.onNext} disabled={!nav.onNext} aria-label="Next title" className={`${NAV_BTN} right-2`}>
                <ChevronRight aria-hidden className="h-5 w-5" />
              </button>
              <span className="absolute left-3 top-3 rounded-full bg-scrim/55 px-2 py-0.5 text-micro font-semibold text-white tabular-nums">
                {nav.position} / {nav.total}
              </span>
            </>
          )}
          {onBack && (
            <button type="button" onClick={onBack} className="absolute left-3 top-2 flex min-h-[44px] items-center gap-1 rounded-control bg-surface/90 px-2 text-meta font-semibold text-fg hover:bg-surface">
              <ChevronLeft aria-hidden className="h-4 w-4" /> Back
            </button>
          )}
          <div className={`absolute bottom-0 left-0 p-4 ${nav ? 'pr-28 sm:px-14' : ''}`}>
            <div className="flex items-end gap-3">
              {detail && <img src={posterUrl(detail.poster_path, 'w92')} alt="" className="w-10 shrink-0 rounded-md" />}
              <div>
                {title && <h2 className="text-title font-semibold leading-tight text-white">{title}</h2>}
                <div className="flex items-center gap-2 text-meta text-white/70 tabular-nums">
                  {year && <span>{year}</span>}
                  {detail?.vote_average ? <span title="Average rating from TMDB users, out of 10">TMDB ★ {detail.vote_average.toFixed(1)}/10</span> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      }
    >
      <div ref={top} />
      {query.isError ? (
        <div className="flex flex-col items-start gap-3 p-5">
          <p className="text-body text-fg-2">Couldn't load this title from TMDB.</p>
          {query.error instanceof Error && <p className="text-meta text-fg-muted">{query.error.message}</p>}
          <Button size="sm" onClick={() => { void query.refetch() }}>Try again</Button>
        </div>
      ) : !detail ? (
        <Skeleton />
      ) : (
        <MediaDetailBody
          key={`${mediaType}-${tmdbId}`}
          detail={detail}
          mediaType={mediaType}
          userEntry={userEntry}
          onRemoved={onRemoved}
          onOpenDetail={onOpenDetail}
        />
      )}
    </ModalShell>
  )
}
