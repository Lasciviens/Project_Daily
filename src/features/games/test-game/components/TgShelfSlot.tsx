import { memo } from 'react'
import type { TgGame } from '../testGameModel'
import { TgGameCard } from './TgGameCard'

/** The two small lamps over a slot and the light pools they cast. */
function Lamp() {
  return (
    <>
      <span aria-hidden className="tg-spot" />
      <span aria-hidden className="tg-lamp is-l" />
      <span aria-hidden className="tg-lamp is-r" />
    </>
  )
}

interface Props {
  /** Omit for an empty, lit slot (the rest of a last shelf, or a spare shelf). */
  game?: TgGame
  selected?: boolean
  /** The one card the shelf's roving tabindex makes tabbable. */
  focusable?: boolean
  onSelect?: (id: string) => void
}

/**
 * One slot of the bookcase: its lamps and, standing on the plank, a case.
 * Memoised so a selection change re-renders two slots, not the library.
 */
export const TgShelfSlot = memo(function TgShelfSlot({ game, selected = false, focusable = false, onSelect }: Props) {
  if (!game || !onSelect) {
    return (
      <div aria-hidden className="tg-slot is-empty">
        <Lamp />
      </div>
    )
  }
  return (
    <div className={selected ? 'tg-slot is-selected' : 'tg-slot'}>
      <Lamp />
      <TgGameCard game={game} selected={selected} onSelect={onSelect} tabIndex={focusable ? 0 : -1} />
    </div>
  )
})
