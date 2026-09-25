import { useState } from 'react'
import type { TgGame } from '../testGameModel'
import { TgGameCard } from './TgGameCard'
import { useElementSize, useRevealCard } from './useShelfLayout'

interface Props {
  games: TgGame[]
  selectedId: string | null
  onSelect: (id: string) => void
}

// Must match the grid template and gap-x-5 below.
const MIN_COL = 132
const GAP_X = 20

/** The second view: a dense wall of covers, no shelves. */
export function TgGridView({ games, selectedId, onSelect }: Props) {
  const [grid, setGrid] = useState<HTMLDivElement | null>(null)
  const size = useElementSize(grid)

  // The same column count `repeat(auto-fill, minmax(132px, 1fr))` resolves
  // to, so every card gets its column's real pixel width.
  const width = size?.w ?? 0
  const cols = Math.max(1, Math.floor((width + GAP_X) / (MIN_COL + GAP_X)))
  const cardWidth = width > 0 ? Math.floor((width - (cols - 1) * GAP_X) / cols) : 0
  const coverHeight = Math.round(cardWidth * 1.3)

  const selectedIndex = selectedId ? games.findIndex(g => g.id === selectedId) : -1
  useRevealCard(grid, selectedId, cardWidth > 0 ? `${cardWidth}:${games.length}:${selectedIndex}` : null)

  return (
    // A stable gutter: a scrollbar appearing must not narrow the columns,
    // shorten the cards and make it disappear again.
    <div className="tg-scroll-y h-full [scrollbar-gutter:stable]" role="region" aria-label="Game covers">
      <div ref={setGrid} className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-5 gap-y-6 px-3 pb-6 pt-4">
        {cardWidth > 0 && games.map(g => (
          <TgGameCard
            key={g.id}
            game={g}
            selected={g.id === selectedId}
            onSelect={onSelect}
            width={cardWidth}
            coverHeight={coverHeight}
          />
        ))}
      </div>
    </div>
  )
}
