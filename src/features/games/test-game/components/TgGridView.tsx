import { useState } from 'react'
import type { TgGame } from '../testGameModel'
import { TgGameCard } from './TgGameCard'
import { useRevealCard } from './useShelfLayout'

interface Props {
  games: TgGame[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The second view: a dense wall of covers, no shelves. Pure CSS sizing — each
 * card fills its auto-fill column and its cover slot keeps a 10:13 box
 * (--tg-cover-aspect on .tg-cover-grid), so nothing is measured in JS and a
 * resize re-renders no card. Off-screen cells skip layout and paint.
 */
export function TgGridView({ games, selectedId, onSelect }: Props) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  useRevealCard(scroller, selectedId, 'grid', games.length)

  return (
    // A stable gutter: a scrollbar appearing must not narrow the columns,
    // shorten the cards and make it disappear again.
    <div ref={setScroller} className="tg-scroll-y h-full [scrollbar-gutter:stable]" role="region" aria-label="Game covers">
      {/* gap-x-5 / gap-y-6 are mirrored by .tg-cell's half-gap reach. */}
      <div className="tg-cover-grid grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-5 gap-y-6 px-3 pb-6 pt-4">
        {games.map(g => {
          const selected = g.id === selectedId
          return (
            <div key={g.id} className={selected ? 'tg-cell is-selected' : 'tg-cell'}>
              <TgGameCard game={g} selected={selected} onSelect={onSelect} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
