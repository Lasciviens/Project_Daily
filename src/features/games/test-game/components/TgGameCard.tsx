import { memo } from 'react'
import { STATUS_TEXT, formatStars, starsFromRating, type TgGame } from '../testGameModel'
import { TgCover } from './TgCover'
import { TgStarIcon } from './TgStars'

interface Props {
  game: TgGame
  selected: boolean
  onSelect: (id: string) => void
  width: number
  coverHeight: number
  /** The shelf keeps one card tabbable and moves between cards with arrow keys. */
  tabIndex?: number
}

/**
 * One box on the shelf or cover wall: the cover standing at its own aspect in
 * a fixed `width` × `coverHeight` slot, then the title and a status/rating row.
 *
 * Memoised: a library can hold well over a thousand of these, and a selection
 * change should repaint two cards, not all of them.
 */
export const TgGameCard = memo(function TgGameCard({ game, selected, onSelect, width, coverHeight, tabIndex }: Props) {
  const stars = starsFromRating(game.rating)
  return (
    <button
      type="button"
      data-game-id={game.id}
      aria-pressed={selected}
      aria-label={game.title}
      tabIndex={tabIndex}
      onClick={() => onSelect(game.id)}
      // The cover's own outline marks keyboard focus; a second ring around the
      // whole card would only compete with the selection glow.
      className={`tg-card block focus-visible:!outline-none ${selected ? 'is-selected' : ''}`}
      style={{ width }}
    >
      <span className="tg-cover-slot" style={{ height: coverHeight }}>
        <TgCover game={game} mode="natural" />
      </span>
      <span title={game.title} className="mt-2 block truncate text-[13px] font-semibold leading-[18px] text-[var(--tg-text)]">
        {game.title}
      </span>
      <span className="mt-1 flex items-center justify-between gap-2 text-[11px] leading-4">
        <span data-status={game.play_status} className="flex min-w-0 items-center gap-1.5">
          <span className="tg-dot" />
          <span className="tg-status-text truncate font-medium">{STATUS_TEXT[game.play_status] ?? game.play_status}</span>
        </span>
        {stars != null && (
          <span className="flex shrink-0 items-center gap-1 font-medium tabular-nums text-[var(--tg-text-2)]">
            <TgStarIcon size={11} />
            {formatStars(stars)}
          </span>
        )}
      </span>
    </button>
  )
})
