import { memo, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TgGame } from '../testGameModel'
import { TgGameCard } from './TgGameCard'
import { SHELF_LABEL, SHELF_SIDE, smoothScroll } from './useShelfLayout'

interface Props {
  games: TgGame[]
  /** Slots per visible shelf: a short shelf is padded with empty, lit slots. */
  cols: number
  selectedId: string | null
  focusId: string | null
  onSelect: (id: string) => void
}

// Wheel delta (px) that moves the shelf by one case. A mouse notch is ~100px,
// a trackpad sends many small deltas; snapping would swallow raw pixel scrolls.
const WHEEL_STEP = 40

// Chevrons centred on the covers, from the geometry TgShelf puts on the case.
const CHEVRON_TOP = `calc(var(--tg-row-h) - ${SHELF_LABEL}px - var(--tg-cover-h) / 2)`

interface Edges { left: boolean; right: boolean }

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

function readEdges(el: HTMLElement): Edges {
  return { left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 }
}

/** Distance between two slots, read from the case's CSS geometry when needed. */
function pitchOf(el: HTMLElement): { pitch: number; gap: number } {
  const s = getComputedStyle(el)
  const gap = parseFloat(s.getPropertyValue('--tg-gap')) || 0
  return { pitch: (parseFloat(s.getPropertyValue('--tg-card-w')) || 0) + gap, gap }
}

/** Whether the bookcase itself can still scroll vertically in `dy`'s direction. */
function caseCanScroll(scroller: HTMLElement | null, dy: number): boolean {
  if (!scroller) return false
  const max = scroller.scrollHeight - scroller.clientHeight
  return dy > 0 ? scroller.scrollTop < max - 1 : scroller.scrollTop > 1
}

/**
 * One shelf of the bookcase: a horizontally scrolling, snapping track of
 * cases standing on a plank, two lamps over every slot, and chevrons that
 * appear only on a side the shelf can actually scroll to.
 */
export const TgShelfRow = memo(function TgShelfRow({ games, cols, selectedId, focusId, onSelect }: Props) {
  const [track, setTrack] = useState<HTMLDivElement | null>(null)
  const [strip, setStrip] = useState<HTMLDivElement | null>(null)
  const [edges, setEdges] = useState<Edges>({ left: false, right: false })

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
    const bookcase = track.parentElement?.closest<HTMLElement>('.tg-scroll-y') ?? null

    let acc = 0
    let settle = 0
    const onWheel = (e: WheelEvent) => {
      // Horizontal gestures and Shift+wheel scroll the track natively.
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      // A vertical wheel scrolls the bookcase first; only once it can't move
      // further that way does it browse along the shelf.
      if (caseCanScroll(bookcase, e.deltaY)) return
      const max = track.scrollWidth - track.clientWidth
      if (max <= 1 || (e.deltaY > 0 && track.scrollLeft >= max - 1) || (e.deltaY < 0 && track.scrollLeft <= 1)) return
      e.preventDefault()
      acc += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * track.clientWidth : e.deltaY
      window.clearTimeout(settle)
      settle = window.setTimeout(() => { acc = 0 }, 200)
      if (Math.abs(acc) >= WHEEL_STEP) {
        track.scrollBy({ left: Math.sign(acc) * pitchOf(track).pitch, behavior: smoothScroll() })
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
  }, [track, strip])

  function page(dir: 1 | -1) {
    if (!track) return
    const { pitch, gap } = pitchOf(track)
    if (pitch <= 0) return
    const perPage = Math.max(1, Math.floor((track.clientWidth - 2 * SHELF_SIDE + gap) / pitch))
    track.scrollBy({ left: dir * perPage * pitch, behavior: smoothScroll() })
  }

  const emptySlots = Math.max(0, cols - games.length)

  return (
    <div className="tg-shelf-row" style={{ height: 'var(--tg-row-h)' }}>
      {/* Underside of the shelf above (lit by the lamps) and the side walls. */}
      <span aria-hidden className="tg-ceiling" />
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-[linear-gradient(180deg,var(--tg-shelf-edge),transparent),linear-gradient(180deg,var(--tg-shelf-edge),transparent_55%)]" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-[linear-gradient(90deg,var(--tg-shelf-edge),transparent)]" />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-[linear-gradient(270deg,var(--tg-shelf-edge),transparent)]" />
      <span aria-hidden className="tg-plank" style={{ height: SHELF_LABEL }} />

      {/* tabIndex -1: the cards carry a roving tabindex, so a scrollable track
          must not become an extra, unnamed Tab stop of its own. */}
      <div ref={setTrack} tabIndex={-1} className="tg-scroll-x relative z-[2] h-full snap-x snap-mandatory scroll-px-11 focus-visible:!outline-none">
        <div ref={setStrip} className="flex h-full w-max px-11" style={{ gap: 'var(--tg-gap)' }}>
          {games.map(g => {
            const selected = g.id === selectedId
            return (
              <div key={g.id} className={selected ? 'tg-slot is-selected' : 'tg-slot'}>
                <Lamp />
                <TgGameCard game={g} selected={selected} onSelect={onSelect} tabIndex={g.id === focusId ? 0 : -1} />
              </div>
            )
          })}
          {Array.from({ length: emptySlots }, (_, i) => (
            <div key={`empty-${i}`} aria-hidden className="tg-slot is-empty">
              <Lamp />
            </div>
          ))}
        </div>
      </div>

      {edges.left && (
        <button type="button" tabIndex={-1} aria-label="Scroll shelf left" onClick={() => page(-1)} className="tg-chevron-btn left-2" style={{ top: CHEVRON_TOP }}>
          <ChevronLeft size={20} strokeWidth={2.5} />
        </button>
      )}
      {edges.right && (
        <button type="button" tabIndex={-1} aria-label="Scroll shelf right" onClick={() => page(1)} className="tg-chevron-btn right-2" style={{ top: CHEVRON_TOP }}>
          <ChevronRight size={20} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
})
