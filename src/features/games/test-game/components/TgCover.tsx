import { useCallback, useReducer, useState, useSyncExternalStore, type CSSProperties, type SyntheticEvent } from 'react'
import { coverCandidates, type TgGame } from '../testGameModel'
import { firstLiveCover, isCoverLoaded, markCoverFailed, markCoverLoaded, reportCoverError, subscribeCoverUrls } from './coverCache'
import { TgCaseArt } from './TgCaseArt'

type CoverMode = 'natural' | 'contain' | 'cover'

interface Props {
  game: TgGame
  mode: CoverMode
  eager?: boolean
  className?: string
  /**
   * natural only: where art that doesn't fill the box sits. `center` (phone
   * grid, cover wall) keeps every cover's middle on one line, so a wide or
   * small cover never drops to the foot of its cell; `bottom` (the shelf) keeps
   * a case standing on its plank.
   */
  align?: 'center' | 'bottom'
}

// Each URL's width/height ratio, learned on load. A natural-mode image is then
// scaled UP to fit its box (a 184px-wide thumbnail in a 170px cell no longer
// sits there at its own tiny size), and an image seen before fits on its first
// frame instead of growing once it loads again.
const ratios = new Map<string, number>()

// Anything smaller is a tracking pixel or a "no image" placeholder, not box art.
const MIN_EDGE = 16

/**
 * A game's box art inside a parent-sized box — the parent fixes the size, so
 * nothing here can shift layout.
 *
 * Walks `coverCandidates` on load errors (a failed URL is skipped at once
 * and re-probed in the background; a second failure is remembered as dead for
 * the session), holds the image invisible until it has
 * decoded — so a broken or half-loaded image is never on screen — and falls
 * back to a drawn case. While an image loads, a static tint holds its place.
 *
 *   natural  the image keeps its own aspect, scaled to fit, centred or
 *            standing bottom-centre (`align`); the image IS the frame, so the
 *            selection outline hugs the real box
 *   contain  fills the box, no crop; the letterbox is left empty, so whatever
 *            surface the box sits on shows through (never a blurred copy)
 *   cover    fills the box, cropped (tiny thumbnails)
 */
export function TgCover({ game, mode, eager = false, className = '', align = 'bottom' }: Props) {
  const [attempt, bump] = useReducer((n: number) => n + 1, 0)
  const [, remeasured] = useReducer((n: number) => n + 1, 0)
  const [fadeSrc, setFadeSrc] = useState<string | null>(null)
  // The <img> element (URL + attempt) that fired onError: hidden from that
  // moment on — a failed image is never on screen, even for a URL that loaded
  // fine earlier in the session.
  const [erroredKey, setErroredKey] = useState<string | null>(null)
  // The first live candidate, re-read when one of this game's URLs settles
  // (a background probe answered) or the network returns.
  const candidates = coverCandidates(game)
  const subscribe = useCallback((cb: () => void) => subscribeCoverUrls(candidates, cb), [candidates])
  const pick = () => firstLiveCover(candidates)
  const src = useSyncExternalStore(subscribe, pick, pick)
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
    // The URL is skipped while it is re-probed in the background (a 'retry'),
    // or dead: either way the next candidate shows now, not after a pause.
    reportCoverError(src)
    bump()
  }

  function onLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    if (img.naturalWidth < MIN_EDGE || img.naturalHeight < MIN_EDGE) {
      // A real (tiny) response, not a blip: no point asking again.
      if (src) markCoverFailed(src)
      return bump()
    }
    if (src && !ratios.has(src)) {
      ratios.set(src, img.naturalWidth / img.naturalHeight)
      if (cached) remeasured() // re-render so the fit applies (no fade: it was already on screen)
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
    const ratio = src ? ratios.get(src) : undefined
    // Contain-fit through container units: the box is a size container, so the
    // art is as wide as fits both edges and keeps its own aspect. The frame
    // still hugs the art (a letterbox around it would carry the shadow).
    const fit: CSSProperties | undefined = ratio
      ? { aspectRatio: String(ratio), width: `min(100cqw, ${ratio} * 100cqh)`, height: 'auto' }
      : undefined
    const place = align === 'center' ? 'inset-0 m-auto' : 'inset-x-0 bottom-0 mx-auto'
    return (
      <div className={`relative flex h-full w-full justify-center [container-type:size] ${align === 'center' ? 'items-center' : 'items-end'} ${className}`}>
        {!src ? (
          <TgCaseArt game={game} className="tg-cover-frame" />
        ) : (
          <>
            {!visible && <span aria-hidden className="tg-cover-ph aspect-[0.7] h-full max-w-full rounded-[4px]" />}
            {/* An absolutely placed replaced element sizes through max-width/
                max-height with its aspect kept, in every engine. `!absolute`
                beats the frame class's own `position: relative`. */}
            <img key={imgKey} {...imgProps} style={fit} className={`tg-cover-frame tg-cover-img !absolute ${place} ${reveal}`} />
          </>
        )}
      </div>
    )
  }

  return (
    // The tint only holds the place while nothing is on screen; once the art
    // shows, a letterboxed cover sits on the caller's own surface.
    <div className={`relative h-full w-full overflow-hidden ${visible && src ? '' : 'bg-[var(--tg-panel-2)]'} ${className}`}>
      {!src ? (
        <TgCaseArt game={game} className="w-full" />
      ) : (
        <>
          {!visible && <span aria-hidden className="tg-cover-ph absolute inset-0" />}
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
