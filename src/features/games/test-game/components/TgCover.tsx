import { useReducer, useState, type SyntheticEvent } from 'react'
import { coverCandidates, type TgGame } from '../testGameModel'
import { firstLiveCover, isCoverLoaded, markCoverFailed, markCoverLoaded, reportCoverError } from './coverCache'
import { TgCaseArt } from './TgCaseArt'

type CoverMode = 'natural' | 'contain' | 'cover'

interface Props {
  game: TgGame
  mode: CoverMode
  eager?: boolean
  className?: string
}

// Anything smaller is a tracking pixel or a "no image" placeholder, not box art.
const MIN_EDGE = 16
// A URL's first error is retried once after this pause (a network blip, not a
// 404); only its second error condemns it for the session.
const RETRY_MS = 1800

/**
 * A game's box art inside a parent-sized box — the parent fixes the size, so
 * nothing here can shift layout.
 *
 * Walks `coverCandidates` on load errors (a URL is retried once, then
 * remembered as dead for the session), holds the image invisible until it has
 * decoded — so a broken or half-loaded image is never on screen — and falls
 * back to a drawn case. While an image loads, a static tint holds its place.
 *
 *   natural  the image keeps its own aspect, standing bottom-centre; the image
 *            IS the frame, so the selection outline hugs the real box
 *   contain  fills the box, no crop, over a blurred copy of itself
 *   cover    fills the box, cropped (tiny thumbnails)
 */
export function TgCover({ game, mode, eager = false, className = '' }: Props) {
  const [attempt, bump] = useReducer((n: number) => n + 1, 0)
  const [fadeSrc, setFadeSrc] = useState<string | null>(null)
  // The <img> element (URL + attempt) that fired onError: hidden from that
  // moment on — a failed image is never on screen, even for a URL that loaded
  // fine earlier in the session.
  const [erroredKey, setErroredKey] = useState<string | null>(null)

  const src = firstLiveCover(coverCandidates(game))
  const imgKey = `${src}#${attempt}`
  // Captured per render: an image the browser already had shows at once, with
  // no fade; one this mount watched arrive fades in.
  const cached = isCoverLoaded(src)
  const fade = src != null && fadeSrc === src
  const visible = (cached || fade) && erroredKey !== imgKey

  function onError() {
    if (!src) return
    setErroredKey(imgKey)
    setFadeSrc(null)
    // The remount after the pause (a new key) requests the same URL again.
    if (reportCoverError(src) === 'retry') window.setTimeout(bump, RETRY_MS)
    else bump()
  }

  function onLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    if (img.naturalWidth < MIN_EDGE || img.naturalHeight < MIN_EDGE) {
      // A real (tiny) response, not a blip: no point asking again.
      if (src) markCoverFailed(src)
      return bump()
    }
    if (cached || !src) return
    markCoverLoaded(src)
    setFadeSrc(src)
  }

  const reveal = !visible ? 'opacity-0' : fade ? 'tg-fade-in' : ''
  const imgProps = {
    src: src ?? undefined,
    alt: '',
    draggable: false,
    decoding: 'async' as const,
    loading: eager ? ('eager' as const) : ('lazy' as const),
    onLoad,
    onError,
  }

  if (mode === 'natural') {
    return (
      <div className={`relative flex h-full w-full items-end justify-center ${className}`}>
        {!src ? (
          <TgCaseArt game={game} className="tg-cover-frame" />
        ) : (
          <>
            {!visible && <span aria-hidden className="tg-cover-ph aspect-[0.7] h-full max-w-full rounded-[4px]" />}
            {/* An absolutely placed replaced element sizes through max-width/
                max-height with its aspect kept, in every engine. `!absolute`
                beats the frame class's own `position: relative`. */}
            <img key={imgKey} {...imgProps} className={`tg-cover-frame tg-cover-img !absolute inset-x-0 bottom-0 mx-auto ${reveal}`} />
          </>
        )}
      </div>
    )
  }

  return (
    <div className={`relative h-full w-full overflow-hidden bg-[var(--tg-panel-2)] ${className}`}>
      {!src ? (
        <TgCaseArt game={game} className="w-full" />
      ) : (
        <>
          {!visible && <span aria-hidden className="tg-cover-ph absolute inset-0" />}
          {mode === 'contain' && visible && (
            <img aria-hidden src={src} alt="" draggable={false} className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-lg" />
          )}
          <img
            key={imgKey}
            {...imgProps}
            className={`absolute inset-0 h-full w-full ${mode === 'contain' ? 'object-contain' : 'object-cover'} ${reveal}`}
          />
        </>
      )}
    </div>
  )
}
