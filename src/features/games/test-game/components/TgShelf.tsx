import { useMemo, useState, type KeyboardEvent } from 'react'
import { chunkShelves, type TgGame } from '../testGameModel'
import { TgShelfRow } from './TgShelfRow'
import { useRevealCard, useShelfLayout } from './useShelfLayout'

interface Props {
  games: TgGame[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The bookcase: as many shelves as fit the height (two to five), each a
 * carousel of cases standing on a lit plank. Arrow keys move the selection —
 * Left/Right along the list, Up/Down to the same place on the next shelf.
 */
export function TgShelf({ games, selectedId, onSelect }: Props) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const layout = useShelfLayout(el)
  const { rows, cols, measured } = layout
  const shelves = useMemo(() => chunkShelves(games, rows, cols), [games, rows, cols])

  // Mirrors chunkShelves' shelf length, so Up/Down lands in the same column.
  const perShelf = Math.max(cols, Math.ceil(games.length / rows))
  const selectedIndex = selectedId ? games.findIndex(g => g.id === selectedId) : -1
  const focusId = selectedIndex >= 0 ? selectedId : games[0]?.id ?? null
  useRevealCard(el, selectedId, measured ? `${rows}x${cols}:${games.length}:${selectedIndex}` : null)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !games.length) return
    const cur = Math.max(0, selectedIndex)
    const last = games.length - 1
    let next: number
    switch (e.key) {
      case 'ArrowLeft': next = Math.max(0, cur - 1); break
      case 'ArrowRight': next = Math.min(last, cur + 1); break
      case 'ArrowUp': next = cur - perShelf >= 0 ? cur - perShelf : cur; break
      case 'ArrowDown': {
        // From a longer shelf onto a shorter last one, land on its last case.
        const onLastShelf = Math.floor(cur / perShelf) === Math.floor(last / perShelf)
        next = cur + perShelf <= last ? cur + perShelf : onLastShelf ? cur : last
        break
      }
      default: return
    }
    e.preventDefault()
    const id = games[next].id
    if (next !== selectedIndex) onSelect(id)
    el?.querySelector<HTMLElement>(`[data-game-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
  }

  return (
    <div
      ref={setEl}
      role="region"
      aria-label="Game shelf"
      onKeyDown={onKeyDown}
      className="tg-scroll-y h-full rounded-2xl"
    >
      <div className="tg-shelf min-h-full">
        {measured && shelves.map((shelf, i) => (
          <TgShelfRow key={i} games={shelf} layout={layout} selectedId={selectedId} focusId={focusId} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
