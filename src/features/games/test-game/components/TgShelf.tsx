import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { chunkShelves, type TgGame } from '../testGameModel'
import { TgShelfRow } from './TgShelfRow'
import { textInset, useRevealCard, useShelfLayout } from './useShelfLayout'

interface Props {
  games: TgGame[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/**
 * The bookcase: as many shelves as fit the height (two to five), each a
 * carousel of cases standing on a lit plank. Arrow keys move the selection —
 * Left/Right along the list, Up/Down to the same place on the next shelf.
 *
 * The geometry reaches the rows and cards as CSS custom properties on the
 * case, never as props: a resize restyles every slot but re-renders no card.
 */
export function TgShelf({ games, selectedId, onSelect }: Props) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  const layout = useShelfLayout(el, games.length)
  const { rows, cols, measured } = layout
  const shelves = useMemo(() => chunkShelves(games, rows, cols), [games, rows, cols])

  // Mirrors chunkShelves' shelf length, so Up/Down lands in the same column.
  const perShelf = Math.max(cols, Math.ceil(games.length / rows))
  const selectedIndex = selectedId ? games.findIndex(g => g.id === selectedId) : -1
  const focusId = selectedIndex >= 0 ? selectedId : games[0]?.id ?? null
  useRevealCard(el, selectedId, measured ? 'shelf' : null, games.length)

  const vars = {
    '--tg-card-w': `${layout.slotWidth}px`,
    '--tg-cover-h': `${layout.coverHeight}px`,
    '--tg-gap': `${layout.gap}px`,
    '--tg-half-gap': `${layout.gap / 2}px`,
    '--tg-row-h': `${layout.rowHeight}px`,
    '--tg-text-inset': `${textInset(layout)}px`,
  } as CSSProperties

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
      <div className="tg-shelf min-h-full" style={vars}>
        {/* Keyed by position: a re-chunk or a sort then moves cards between
            shelves that stay mounted, instead of remounting whole shelves. */}
        {measured && shelves.map((shelf, i) => (
          <TgShelfRow key={i} games={shelf} cols={cols} selectedId={selectedId} focusId={focusId} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}
