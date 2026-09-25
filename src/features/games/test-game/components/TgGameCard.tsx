import { memo, type CSSProperties } from 'react'
import { formatStars, starsFromRating, type TgGame } from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStarIcon } from './TgStars'
import { TgStatusIcon } from './TgStatusIcon'
import { gameCardLabel, statusLabel } from './TgStatusMeta'

interface Props {
  game: TgGame
  selected: boolean
  onSelect: (id: string) => void
  /**
   * Optional fixed size. The shelf and the cover grid leave these out and size
   * every card through CSS custom properties on their container
   * (--tg-card-w, --tg-cover-h, --tg-cover-aspect), so a resize never
   * re-renders a card.
   */
  width?: number
  coverHeight?: number
  /** The shelf keeps one card tabbable and moves between cards with arrow keys. */
  tabIndex?: number
}

/**
 * One box on the shelf or cover wall: the cover standing at its own aspect in
 * its slot, then the title and a status/rating row lined up with the cover.
 *
 * Memoised: a library can hold well over a thousand of these, and a selection
 * change should repaint two cards, not all of them.
 */
export const TgGameCard = memo(function TgGameCard({ game, selected, onSelect, width, coverHeight, tabIndex }: Props) {
  const stars = starsFromRating(game.rating)
  const size = width == null && coverHeight == null ? undefined : ({
    ...(width != null && { '--tg-card-w': `${width}px` }),
    ...(coverHeight != null && { '--tg-cover-h': `${coverHeight}px` }),
  } as CSSProperties)
  return (
    <button
      type="button"
      data-game-id={game.id}
      aria-pressed={selected}
      // Everything the card shows, not the title alone (the art and the star
      // glyph are decorative).
      aria-label={gameCardLabel(game)}
      tabIndex={tabIndex}
      onClick={() => onSelect(game.id)}
      // The cover's own outline marks keyboard focus; a second ring around the
      // whole card would only compete with the selection glow.
      className={`tg-card block focus-visible:!outline-none ${selected ? 'is-selected' : ''}`}
      style={size}
    >
      <span className="tg-cover-slot">
        <TgCover game={game} mode="natural" />
      </span>
      <span className="tg-card-text">
        <span title={game.title} className="mt-2 block truncate text-[12px] font-medium leading-[18px] text-[var(--tg-text)]">
          {game.title}
        </span>
        <span className="mt-1 flex items-center justify-between gap-2 text-[12px] leading-4">
          <span data-status={game.play_status} className="flex min-w-0 items-center gap-1.5">
            <TgStatusIcon status={game.play_status} />
            <span className="tg-status-text truncate font-medium">{statusLabel(game.play_status)}</span>
          </span>
          {stars != null && (
            <span className="flex shrink-0 items-center gap-1 font-medium tabular-nums text-[var(--tg-text-2)]">
              <TgStarIcon size={13} />
              {formatStars(stars)}
            </span>
          )}
        </span>
      </span>
    </button>
  )
})
