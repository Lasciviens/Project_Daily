import { memo, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import { TgGameCard } from './TgGameCard'
import { SHELF_LABEL, SHELF_SIDE, smoothScroll, type ShelfLayout } from './useShelfLayout'

interface Props {
  games: TgGame[]
  layout: ShelfLayout
  selectedId: string | null
  focusId: string | null
  onSelect: (id: string) => void
}

// Wheel delta (px) that moves the shelf by one case. A mouse notch is ~100px,
// a trackpad sends many small deltas; snapping would swallow raw pixel scrolls.
const WHEEL_STEP = 40

interface Edges { left: boolean; right: boolean }

/** The light pool over a slot and the small fixture on the ceiling casting it. */
function Lamp() {
  return (
    <>
      <span aria-hidden className="tg-spot" />
      <span aria-hidden className="pointer-events-none absolute left-1/2 top-[3px] h-[3px] w-[34%] -translate-x-1/2 rounded-full bg-[color-mix(in_srgb,var(--tg-spot-core),white_55%)] shadow-[shadow:0_0_12px_3px_var(--tg-spot)]" />
    </>
  )
}

function readEdges(el: HTMLElement): Edges {
  return { left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }
}

/**
 * One shelf of the bookcase: a horizontally scrolling, snapping track of
 * cases standing on a plank, a lamp over every slot, and chevrons that appear
 * only on a side the shelf can actually scroll to.
 */
export const TgShelfRow = memo(function TgShelfRow({ games, layout, selectedId, focusId, onSelect }: Props) {
  const [track, setTrack] = useState<HTMLDivElement | null>(null)
  const [strip, setStrip] = useState<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState<Edges>({ left: false, right: false })
  const { slotWidth, coverHeight, gap, rowHeight, cols } = layout
  const pitch = slotWidth + gap

  useEffect(() => {
    if (!track) return
    const update = () => {
      const next = readEdges(track)
      setEdges(prev => (prev.left === next.left && prev.right === next.right ? prev : next))
    }
    const ro = new ResizeObserver(update)
    ro.observe(track)
    if (strip) ro.observe(strip)
    track.addEventListener('scroll', update, { passive: true })

    let acc = 0
    let settle = 0
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      const max = track.scrollWidth - track.clientWidth
      if (max <= 1 || (e.deltaY > 0 && track.scrollLeft >= max - 1) || (e.deltaY < 0 && track.scrollLeft <= 1)) return
      e.preventDefault()
      acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * track.clientWidth : e.deltaY
      window.clearTimeout(settle)
      settle = window.setTimeout(() => { acc = 0 }, 200)
      if (Math.abs(acc) >= WHEEL_STEP) {
        track.scrollBy({ left: Math.sign(acc) * pitch, behavior: smoothScroll() })
        acc = 0
      }
    }
    track.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      ro.disconnect()
      track.removeEventListener('scroll', update)
      track.removeEventListener('wheel', onWheel)
      window.clearTimeout(settle)
    }
  }, [track, strip, pitch])

  function page(dir: 1 | -1) {
    if (!track) return
    const perPage = Math.max(1, Math.floor((track.clientWidth - 2 * SHELF_SIDE + gap) / pitch))
    track.scrollBy({ left: dir * perPage * pitch, behavior: smoothScroll() })
  }

  const chevronTop = rowHeight - SHELF_LABEL - coverHeight / 2
  const emptySlots = Math.max(0, cols - games.length)

  return (
    <div className="tg-shelf-row" style={{ height: rowHeight }}>
      {/* Underside of the shelf above (lit by the lamps) and the side walls. */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-[linear-gradient(180deg,var(--tg-shelf-edge),transparent),linear-gradient(180deg,var(--tg-shelf-edge),transparent_55%)]" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-[linear-gradient(90deg,var(--tg-shelf-edge),transparent)]" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-[linear-gradient(270deg,var(--tg-shelf-edge),transparent)]" />
      <span aria-hidden className="tg-plank" style={{ height: SHELF_LABEL }} />

      <div ref={setTrack} className="tg-scroll-x relative z-[2] h-full snap-x snap-mandatory scroll-px-11">
        <div ref={setStrip} className="flex h-full w-max px-11" style={{ gap }}>
          {games.map(g => (
            <div key={g.id} className="relative flex h-full shrink-0 items-end pb-[14px]" style={{ width: slotWidth }}>
              <Lamp />
              <TgGameCard
                game={g}
                selected={g.id === selectedId}
                onSelect={onSelect}
                width={slotWidth}
                coverHeight={coverHeight}
                tabIndex={g.id === focusId ? 0 : -1}
              />
            </div>
          ))}
          {Array.from({ length: emptySlots }, (_, i) => (
            <div key={`empty-${i}`} aria-hidden className="relative h-full shrink-0" style={{ width: slotWidth }}>
              <Lamp />
            </div>
          ))}
        </div>
      </div>

      {edges.left && (
        <button type="button" tabIndex={-1} aria-label="Scroll shelf left" onClick={() => page(-1)} className="tg-chevron-btn left-2" style={{ top: chevronTop }}>
          <ChevronLeft size={18} strokeWidth={2} />
        </button>
      )}
      {edges.right && (
        <button type="button" tabIndex={-1} aria-label="Scroll shelf right" onClick={() => page(1)} className="tg-chevron-btn right-2" style={{ top: chevronTop }}>
          <ChevronRight size={18} strokeWidth={2} />
        </button>
      )}
    </div>
  )
})
