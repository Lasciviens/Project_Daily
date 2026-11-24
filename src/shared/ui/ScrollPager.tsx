import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from '../hooks/useMotion'
import { cx } from './cx'
import { pageStep, scrollEdges, type ScrollEdges } from './scrollPagerRules'

/** Which ways `track` can still scroll sideways; follows scrolling, resizing and new children. */
function useScrollEdges(track: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ back: false, forward: false })
  useEffect(() => {
    const el = track.current
    if (!el) return
    const update = () => setEdges(prev => {
      const next = scrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth)
      return prev.back === next.back && prev.forward === next.forward ? prev : next
    })
    // The track and each child: a picture that loads (a screenshot) or a new card widens
    // what scrolls without resizing the track itself.
    const resized = new ResizeObserver(update)
    const watch = () => { resized.observe(el); for (const child of el.children) resized.observe(child) }
    watch()
    update()
    const changed = new MutationObserver(() => { watch(); update() })
    changed.observe(el, { childList: true })
    el.addEventListener('scroll', update, { passive: true })
    return () => { resized.disconnect(); changed.disconnect(); el.removeEventListener('scroll', update) }
  }, [track])
  return edges
}

interface PagerProps {
  /** The element that scrolls sideways. */
  track: RefObject<HTMLElement | null>
  /** What one press brings into view, for the buttons' names: "screen" → "Previous screen" / "Next screen". */
  noun: string
  /** Paged (a glance tile): one press = one whole screen; otherwise 80 % of the view. */
  paged?: boolean
  /**
   * `inline`: two small chevrons around `children` (a glance tile's dots), always there on a
   * mouse or trackpad, dimmed at an end. `overlay`: round buttons over the track's left and
   * right edges, shown only while there is more that way (the parent must be `relative`).
   */
  placement: 'inline' | 'overlay'
  children?: ReactNode
}

// 16px, the height of the line it sits on (a glance tile keeps its height); `before:` widens what a click hits by 6px a side.
const INLINE_BTN = 'relative grid h-4 w-4 shrink-0 place-items-center rounded-full before:absolute before:-inset-1.5 before:content-[""] text-fg-muted transition-colors duration-100 hover:bg-surface-hover hover:text-fg aria-disabled:cursor-default aria-disabled:bg-transparent aria-disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5'
const OVERLAY_BTN = 'absolute top-1/2 z-[1] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 text-fg-2 shadow-menu transition-colors duration-100 hover:bg-surface-hover hover:text-fg [&_svg]:h-4 [&_svg]:w-4'

/**
 * Previous / next buttons for anything that scrolls sideways (THEME.md §5): a mouse
 * without a sideways wheel can't swipe. They show only on a mouse or trackpad
 * (`pointer: fine`); touch keeps its swipe. ←/→ on a button move too.
 */
export function ScrollPager({ track, noun, paged = false, placement, children }: PagerProps) {
  const edges = useScrollEdges(track)
  const reduced = useReducedMotion()
  const move = (dir: 1 | -1) => {
    const el = track.current
    if (el) el.scrollBy({ left: dir * pageStep(el.clientWidth, paged), behavior: reduced ? 'auto' : 'smooth' })
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
  }
  // A click on a button inside a tile is the button's own, never the tile's tap — a dimmed
  // one too (aria-disabled, not disabled: a disabled button's click would reach the tile).
  const press = (dir: 1 | -1, can: boolean) => (e: { stopPropagation: () => void }) => { e.stopPropagation(); if (can) move(dir) }
  const prevLabel = `Previous ${noun}`
  const nextLabel = `Next ${noun}`

  if (placement === 'inline') {
    return (
      <span className="flex shrink-0 items-center">
        <button type="button" aria-label={prevLabel} title={prevLabel} aria-disabled={!edges.back} onClick={press(-1, edges.back)} onKeyDown={onKeyDown}
          className={cx(INLINE_BTN, '[@media(pointer:coarse)]:hidden')}>
          <ChevronLeft aria-hidden />
        </button>
        {children}
        <button type="button" aria-label={nextLabel} title={nextLabel} aria-disabled={!edges.forward} onClick={press(1, edges.forward)} onKeyDown={onKeyDown}
          className={cx(INLINE_BTN, '[@media(pointer:coarse)]:hidden')}>
          <ChevronRight aria-hidden />
        </button>
      </span>
    )
  }
  return (
    <>
      {edges.back && (
        <button type="button" aria-label={prevLabel} title={prevLabel} onClick={press(-1, true)} onKeyDown={onKeyDown}
          className={cx(OVERLAY_BTN, '[@media(pointer:coarse)]:hidden left-1')}>
          <ChevronLeft aria-hidden />
        </button>
      )}
      {edges.forward && (
        <button type="button" aria-label={nextLabel} title={nextLabel} onClick={press(1, true)} onKeyDown={onKeyDown}
          className={cx(OVERLAY_BTN, '[@media(pointer:coarse)]:hidden right-1')}>
          <ChevronRight aria-hidden />
        </button>
      )}
    </>
  )
}

interface StripProps {
  /** For the buttons' names: "games" → "Previous games" / "Next games". */
  noun: string
  /** The track's own classes (flex, gap, padding); it scrolls sideways with its bar hidden. */
  className?: string
  /** The track's role and name, when it has one (a tab list). */
  role?: string
  'aria-label'?: string
  children: ReactNode
}

/**
 * A row that scrolls sideways (a strip of cards, a row of chips) with ScrollPager's
 * buttons over its edges: swipe on touch, the buttons with a mouse.
 */
export function PagedStrip({ noun, className, role, 'aria-label': ariaLabel, children }: StripProps) {
  const track = useRef<HTMLDivElement>(null)
  return (
    <div className="relative min-w-0">
      <div ref={track} role={role} aria-label={ariaLabel} className={cx('scrollbar-none overflow-x-auto overscroll-x-contain', className)}>
        {children}
      </div>
      <ScrollPager track={track} noun={noun} placement="overlay" />
    </div>
  )
}
