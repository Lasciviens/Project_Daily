import { useMemo, useReducer, useState, type SyntheticEvent } from 'react'
import { formatStars, heroCandidates, subtitleParts, type TgGame } from '../testGameModel'
import { firstLiveCover, isCoverLoaded, markCoverFailed, markCoverLoaded, reportCoverError } from './coverCache'
import { TgCover } from './TgCover'
import { TgStars } from './TgStars'
import { TgStatusMenu } from './TgStatusMenu'
import { useDetailState } from './TgDetailState'
import { useStableValue } from './useStableValue'

type Variant = 'panel' | 'sheet'

interface Props {
  game: TgGame
  variant: Variant
  /** Steam store genre, for rows imported without one. */
  steamGenre?: string | null
}

// Anything smaller is a tracking pixel or a "no image" placeholder, not art.
const MIN_EDGE = 16
const RETRY_MS = 1200

// The panel fills the viewport's height, so its hero grows with it: 208px on
// a laptop-height screen (1469×680, where the whole card fits without
// scrolling, as drawn), ~300px at 800px tall, and on a monitor (the taller
// content of TgDetailPanel's min-height rules) ~530px at 1130 — so the card is
// filled instead of leaving a blank band over the footer. The sheet scrolls,
// so it keeps the design's proportion instead.
const HERO_SIZE: Record<Variant, string> = {
  panel: 'h-[clamp(208px,calc(100dvh-500px),440px)] [@media(min-height:1000px)]:h-[clamp(400px,calc(100dvh-600px),640px)]',
  sheet: 'aspect-[5/3]',
}

/**
 * The scene art. Walks `heroCandidates` past URLs the session knows are dead
 * (the shared cover cache, so the shell's backdrop skips them too), retries a
 * failed URL once before condemning it, and paints the blurred box art
 * underneath until the picture has decoded.
 */
function HeroArt({ game, variant }: { game: TgGame; variant: Variant }) {
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const [retried, setRetried] = useState<string | null>(null)
  const [fadeSrc, setFadeSrc] = useState<string | null>(null)
  // The attempt (URL, or URL#retry) whose load just failed. A URL that loaded
  // earlier counts as cached and is shown without a fade, so without this a
  // later failure of that same URL left the browser's broken-image icon on
  // screen for the whole retry pause.
  const [failedKey, setFailedKey] = useState<string | null>(null)

  // Holding an arrow key along the shelf passes a game every few frames: only
  // the one the user stops on downloads its full-size art. Art the browser
  // already has shows at once.
  const settledId = useStableValue(game.id, 250)
  const candidates = useMemo(() => heroCandidates(game), [game])
  const live = firstLiveCover(candidates)
  const cached = isCoverLoaded(live)
  const url = settledId === game.id || cached ? live : null
  const attemptKey = url != null && retried === url ? `${url}#retry` : url
  const reveal = attemptKey != null && failedKey === attemptKey ? 'opacity-0'
    : url != null && fadeSrc === url ? 'tg-fade-in' : cached ? '' : 'opacity-0'

  function onError() {
    if (!url) return
    setFailedKey(attemptKey)
    if (reportCoverError(url) === 'retry') window.setTimeout(() => setRetried(url), RETRY_MS)
    else bump()
  }

  function onLoad(e: SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    if (!url) return
    if (img.naturalWidth < MIN_EDGE || img.naturalHeight < MIN_EDGE) { markCoverFailed(url); bump(); return }
    if (cached) return
    markCoverLoaded(url)
    setFadeSrc(url)
  }

  return (
    <div className={`tg-hero bg-[var(--tg-panel-2)] ${HERO_SIZE[variant]}`}>
      <div aria-hidden className="absolute inset-0 scale-125 opacity-70 blur-2xl">
        <TgCover game={game} mode="cover" />
      </div>
      {url && (
        <img
          key={attemptKey ?? undefined}
          src={url}
          alt=""
          decoding="async"
          fetchPriority="high"
          draggable={false}
          onLoad={onLoad}
          onError={onError}
          className={`tg-hero-img ${reveal}`}
        />
      )}
      <div className="tg-hero-fade" />
    </div>
  )
}

/**
 * Hero, overlapping box art and the title block, as drawn: the cover and the
 * text column share one fixed-height row pulled up into the hero, bottom
 * aligned, so a two-line title grows UP into the art instead of pushing the
 * info rows down. Monitor-size panels scale the row up with the hero.
 */
export function TgDetailHero({ game, variant, steamGenre }: Props) {
  const { stars, setStars } = useDetailState(game)
  const subtitle = subtitleParts(game, steamGenre).join(' · ')

  return (
    <div>
      <HeroArt game={game} variant={variant} />
      <div className="relative -mt-[118px] flex h-[150px] items-end gap-4 px-5 2xl:-mt-[140px] 2xl:h-[184px]">
        <div className="relative h-[150px] w-[108px] shrink-0 overflow-hidden rounded-lg bg-[var(--tg-panel-2)] shadow-[shadow:var(--tg-cover-shadow)] ring-1 ring-[var(--tg-border-strong)] 2xl:h-[184px] 2xl:w-[132px]">
          <TgCover game={game} mode="contain" eager />
        </div>

        <div className="-mb-2 min-w-0 flex-1">
          <h2 className="line-clamp-2 break-words text-[20px] font-bold leading-[1.25] text-[var(--tg-text)] 2xl:text-[22px]">
            {game.title}
          </h2>
          {subtitle && <p className="mt-1 truncate text-[12px] text-[var(--tg-muted)] 2xl:text-[13px]">{subtitle}</p>}
          {/* Fixed-height line: an interactive TgStars keeps its 44px hit area
              (overflowing evenly) without spreading the block apart. Touch
              stars are wider, so the label drops its suffix there. */}
          <div className="mt-2 flex h-5 items-center gap-2">
            <TgStars stars={stars} size={15} onChange={setStars} />
            <span className="whitespace-nowrap text-[12px] tabular-nums text-[var(--tg-muted)]">
              {stars == null ? 'Not rated' : (
                <>{formatStars(stars)}/5<span className="[@media(pointer:coarse)]:hidden"> (My Rating)</span></>
              )}
            </span>
          </div>
          <TgStatusMenu game={game} className="mt-3" />
        </div>
      </div>
    </div>
  )
}
