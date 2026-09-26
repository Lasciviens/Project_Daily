import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { TgGame } from '../testGameModel'
import { TgShelfSlot } from './TgShelfSlot'
import { shelfVars, useRevealCard, useShelfLayout } from './useShelfLayout'
import { useScrollReset } from './useScrollReset'
import { gridStep, stepOrigin } from './tgGridNav'

interface Props {
  games: TgGame[]
  selectedId: string | null
  /** Changes when the list is a different list (section, filters, sort): back to the top. */
  resetKey?: string
  onSelect: (id: string) => void
}

/**
 * The bookcase: full shelves stacked top to bottom, as many cases per shelf
 * as fit the width, the whole case scrolling vertically. Spare lit shelves
 * fill the view when the library is short, so it always reads as a bookcase.
 * Arrow keys move the selection — Left/Right along the list, Up/Down one
 * shelf, Home/End to the ends.
 *
 * One CSS grid holds every case (the planks, ceilings and walls are painted
 * per row by .tg-case), and the geometry reaches it as CSS custom
 * properties: a resize restyles the case but re-renders no card, and nothing
 * is ever re-chunked into rows. Off-screen slots skip layout and paint.
 */
export function TgShelf({ games, selectedId, onSelect, resetKey }: Props) {
  const [el, setEl] = useState<HTMLDivElement | null>(null)
  useScrollReset(el, resetKey)
  const layout = useShelfLayout(el)
  const { cols, rows, measured } = layout

  const selectedIndex = selectedId ? games.findIndex(g => g.id === selectedId) : -1
  const focusId = selectedIndex >= 0 ? selectedId : games[0]?.id ?? null
  useRevealCard(el, selectedId, measured ? 'shelf' : null, games.length)

  const shelves = Math.max(rows, Math.ceil(games.length / cols))
  const emptySlots = shelves * cols - games.length

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const next = gridStep(e.key, stepOrigin(e.target, games, selectedIndex), games.length - 1, cols)
    if (next == null) return
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
      className="tg-scroll-y h-full rounded-2xl [scrollbar-gutter:stable]"
    >
      <div className="tg-shelf min-h-full">
        {measured && (
          <div className="tg-case" style={shelfVars(layout) as CSSProperties}>
            {games.map(g => (
              <TgShelfSlot key={g.id} game={g} selected={g.id === selectedId} focusable={g.id === focusId} onSelect={onSelect} />
            ))}
            {Array.from({ length: emptySlots }, (_, i) => <TgShelfSlot key={`empty-${i}`} />)}
          </div>
        )}
      </div>
    </div>
  )
}
