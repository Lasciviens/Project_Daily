import { useRef, useState, type KeyboardEvent } from 'react'
import { cardMeta, type TgGame } from '../testGameModel'
import { useTestGameStore } from '../testGameStore'
import { formatPlaytime } from '../../api/playtimeFormat'
import { TgGameCard } from './TgGameCard'
import { useScrollReset } from './useScrollReset'
import { useRevealCard } from './useShelfLayout'
import { gridColumnCount, gridStep, stepOrigin } from './tgGridNav'

interface Props {
  games: TgGame[]
  selectedId: string | null
  /** Changes when the list is a different list (section, filters, sort): back to the top. */
  resetKey?: string
  onSelect: (id: string) => void
}

/**
 * The second view: a dense wall of covers, no shelves. Pure CSS sizing — each
 * card fills its auto-fill column and its cover slot keeps a 10:13 box
 * (--tg-cover-aspect on .tg-cover-grid), so nothing is measured in JS and a
 * resize re-renders no card. Off-screen cells skip layout and paint. Arrow
 * keys walk it like the bookcase (one card is a tab stop, not all of them).
 */
export function TgGridView({ games, selectedId, onSelect, resetKey }: Props) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const sort = useTestGameStore(s => s.sort)
  useScrollReset(scroller, resetKey)
  useRevealCard(scroller, selectedId, 'grid', games.length)
  const gridRef = useRef<HTMLDivElement>(null)
  const selectedIndex = selectedId ? games.findIndex(g => g.id === selectedId) : -1
  const focusId = selectedIndex >= 0 ? selectedId : games[0]?.id ?? null

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    // The column count is whatever auto-fill laid out at this width.
    const next = gridStep(e.key, stepOrigin(e.target, games, selectedIndex), games.length - 1, gridColumnCount(gridRef.current))
    if (next == null) return
    e.preventDefault()
    const id = games[next].id
    if (next !== selectedIndex) onSelect(id)
    scroller?.querySelector<HTMLElement>(`[data-game-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
  }

  return (
    // A stable gutter: a scrollbar appearing must not narrow the columns,
    // shorten the cards and make it disappear again.
    <div ref={setScroller} onKeyDown={onKeyDown} className="tg-scroll-y h-full [scrollbar-gutter:stable]" role="region" aria-label="Game covers">
      {/* gap-x-5 / gap-y-6 are mirrored by .tg-cell's half-gap reach. */}
      <div ref={gridRef} className="tg-cover-grid grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-5 gap-y-6 px-3 pb-6 pt-4">
        {games.map(g => {
          const selected = g.id === selectedId
          return (
            <div key={g.id} className={selected ? 'tg-cell is-selected' : 'tg-cell'}>
              <TgGameCard game={g} selected={selected} onSelect={onSelect} tabIndex={g.id === focusId ? 0 : -1} coverAlign="center" meta={cardMeta(g, sort, formatPlaytime)} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
