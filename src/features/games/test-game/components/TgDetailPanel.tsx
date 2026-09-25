import { useEffect, useMemo, useRef } from 'react'
import { Gamepad2, X } from 'lucide-react'
import { sceneImages, type TgGame } from '../testGameModel'
import type { TgActions } from '../tgTypes'
import { TgDetailHero } from './TgDetailHero'
import { TgDetailInfo } from './TgDetailInfo'
import { TgDetailDescription } from './TgDetailDescription'
import { TgDetailActions } from './TgDetailActions'
import { TgScreenshotStrip } from './TgScreenshotStrip'
import { useSteamExtras } from './useSteamExtras'

interface Props {
  game: TgGame | null
  actions: TgActions
  variant: 'panel' | 'sheet'
  onClose?: () => void
}

const firstText = (...xs: (string | null | undefined)[]) => xs.map(x => x?.trim()).find(Boolean) ?? null

/** The right-hand detail card (desktop), or the same content inside a sheet. */
export function TgDetailPanel({ game, actions, variant, onClose }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const extras = useSteamExtras(game?.steamAppId ?? null)
  const gameId = game?.id ?? null

  // A new selection starts at the top, not at the old game's scroll depth.
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [gameId])

  const images = useMemo(() => (game ? sceneImages(game, extras.screenshots) : []), [game, extras.screenshots])
  const fullSize = useMemo(
    () => Object.fromEntries(extras.screenshots.map((t, i) => [t, extras.fullScreenshots[i]])),
    [extras.screenshots, extras.fullScreenshots],
  )

  const shell = variant === 'panel'
    ? 'tg-panel h-full w-full'
    : 'h-full w-full bg-[var(--tg-panel)]'

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

  return (
    <div className={`${shell} relative flex flex-col overflow-hidden`}>
      <div ref={bodyRef} className="tg-scroll-y min-h-0 flex-1">
        <TgDetailHero game={game} variant={variant} steamGenre={extras.genre} />
        <div className="flex flex-col gap-3.5 px-5 pb-2 pt-4">
          <TgDetailInfo game={game} extras={extras} />
          {description && <TgDetailDescription key={`text-${game.id}`} text={description} />}
          <TgScreenshotStrip key={`shots-${game.id}`} images={images} title={game.title} fullSize={fullSize} />
        </div>
        {/* Softens content scrolling under the pinned footer; over padding when nothing scrolls. */}
        <div aria-hidden className="pointer-events-none sticky bottom-0 -mt-2 h-2 bg-gradient-to-t from-[var(--tg-panel)] to-transparent" />
      </div>

      <TgDetailActions game={game} actions={actions} variant={variant} />

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
