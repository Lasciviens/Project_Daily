import { useEffect, useMemo, useRef } from 'react'
import { Gamepad2, X } from 'lucide-react'
import { sceneImages, type TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { TgDetailHero } from './TgDetailHero'
import { TgDetailInfo } from './TgDetailInfo'
import { TgDetailDescription } from './TgDetailDescription'
import { TgDetailActions } from './TgDetailActions'
import { TgDetailFields } from './TgDetailFields'
import { TgDetailScreenScraper } from './TgDetailScreenScraper'
import { TgScreenshotStrip } from './TgScreenshotStrip'
import { useSteamExtras } from './useSteamExtras'
import { useStableValue } from './useStableValue'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'

interface Props {
  game: TgGame | null
  actions: TgActions
  /**
   * `panel` — a standalone card (its own border and radius); `overlay` — the
   * same card filling the tablet/desktop overlay, which owns the edge, radius
   * and shadow; `sheet` — inside the phone's full-screen sheet.
   */
  variant: 'panel' | 'overlay' | 'sheet'
  onClose?: () => void
}

const SHELL: Record<Props['variant'], string> = {
  panel: 'tg-panel h-full w-full',
  overlay: 'h-full w-full bg-[var(--tg-panel)]',
  sheet: 'h-full w-full bg-[var(--tg-panel)]',
}

const firstText = (...xs: (string | null | undefined)[]) => xs.map(x => x?.trim()).find(Boolean) ?? null

/** The detail card: the tablet/desktop overlay's content, or the same inside the phone sheet. */
export function TgDetailPanel({ game, actions, variant, onClose }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const extras = useSteamExtras(game?.steamAppId ?? null)
  const gameId = game?.id ?? null
  // Arrowing along the shelf passes a game every few frames; screenshots (often
  // full-size ES-DE originals) load only for the one the user stops on. The
  // hero debounces the same way (TgDetailHero).
  const settledId = useStableValue(gameId, 250)

  // A new selection starts at the top, not at the old game's scroll depth.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [gameId])

  const images = useMemo(() => (game ? sceneImages(game, extras.screenshots) : []), [game, extras.screenshots])
  const fullSize = useMemo(
    () => Object.fromEntries(extras.screenshots.map((t, i) => [t, extras.fullScreenshots[i]])),
    [extras.screenshots, extras.fullScreenshots],
  )

  const shell = SHELL[variant]
  // The hero and footer size themselves for a viewport-tall card or a sheet.
  const layout = variant === 'sheet' ? 'sheet' : 'panel'

  if (!game) {
    return (
      <div className={`${shell} flex flex-col items-center justify-center gap-3 p-8 text-center`}>
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--tg-panel-2)] text-[var(--tg-accent)]">
          <Gamepad2 aria-hidden className="h-6 w-6" strokeWidth={1.75} />
        </span>
        <p className="text-[14px] font-semibold text-[var(--tg-text)]">Select a game to see its details</p>
        <p className="max-w-[240px] text-[12.5px] text-[var(--tg-muted)]">Playtime, rating, status and screenshots appear here.</p>
      </div>
    )
  }

  const description = firstText(game.description, extras.description, game.storyline)
  // Its own block, unless it already stands in for a missing description.
  const storyline = firstText(game.storyline)
  const showStory = storyline != null && storyline !== description
  // The sheet scrolls, so it shows every word; the viewport-tall overlay clamps.
  const textMode = variant === 'sheet' ? 'full' : 'clamped'

  return (
    <div className={`${shell} relative flex flex-col overflow-hidden`}>
      <div ref={bodyRef} className="tg-scroll-y min-h-0 flex-1">
        <TgDetailHero game={game} variant={layout} steamGenre={extras.genre} />
        {/* Tall screens (a monitor) space the block out and let the text and
            screenshots grow (TgDetailInfo/Description/ScreenshotStrip), so the
            card fills the panel instead of leaving a blank band over the footer. */}
        <div className="flex flex-col gap-3.5 px-5 pb-2 pt-4 [@media(min-height:1000px)]:gap-5 [@media(min-height:1000px)]:pt-5">
          <TgDetailInfo game={game} extras={extras} />
          {description && <TgDetailDescription key={`text-${game.id}`} text={description} mode={textMode} />}
          <TgScreenshotStrip key={`shots-${game.id}`} images={images} title={game.title} fullSize={fullSize} defer={settledId !== game.id} />
          {showStory && <TgDetailDescription key={`story-${game.id}`} text={storyline} label="Storyline" mode={textMode} />}
          {/* Each renders free-form stored records (variant rows, their
              scraped record); a bad field loses its own block, never the panel. */}
          {/* The phone sheet builds the long record once its slide-in is done
              (the selection has rested), not during the animation. */}
          {(variant !== 'sheet' || settledId === game.id) && (
            <ErrorBoundary key={`f-${game.id}`} label="Details" action="games_detail_fields"><TgDetailFields game={game} /></ErrorBoundary>
          )}
          <ErrorBoundary key={`s-${game.id}`} label="ScreenScraper" action="games_detail_screenscraper"><TgDetailScreenScraper game={game} settled={settledId === game.id} /></ErrorBoundary>
        </div>
        {/* Softens content scrolling under the pinned footer; over padding when nothing scrolls. */}
        <div aria-hidden className="pointer-events-none sticky bottom-0 -mt-2 h-2 bg-gradient-to-t from-[var(--tg-panel)] to-transparent" />
      </div>

      <TgDetailActions game={game} actions={actions} variant={layout} />

      {variant === 'sheet' && onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          // Headless UI's initial focus lands here, not on the rating stars.
          data-autofocus
          className="tg-icon-btn absolute right-3 top-[calc(env(safe-area-inset-top)+12px)] z-10 !rounded-full border border-[var(--tg-border)] bg-[color-mix(in_srgb,var(--tg-panel)_72%,transparent)] text-[var(--tg-text)] backdrop-blur-md"
        >
          <X aria-hidden className="h-5 w-5" strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
