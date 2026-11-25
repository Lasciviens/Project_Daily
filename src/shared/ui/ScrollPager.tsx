import { useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from '../hooks/useMotion'
import { useScrollEdges } from '../hooks/useScrollEdges'
import { cx } from './cx'
import { pageStep } from './scrollPagerRules'

/** `app`: the app's tokens. `games`: the Games page's own round chevron (`tg-chevron-btn`, testGame.css). */
type PagerLook = 'app' | 'games'

interface PagerProps {
  /** The element that scrolls sideways. */
  track: RefObject<HTMLElement | null>
  /** What one press brings into view, for the buttons' names: "screen" → "Previous screen" / "Next screen". */
  noun: string
  /** Paged (a glance tile): one press = one whole screen; otherwise 80 % of the view. */
  paged?: boolean
  /**
   * `inline`: two small chevrons around `children` (a glance tile's dots), dimmed at an end.
   * `overlay`: round buttons over the track's left and right edges, visible only while there
   * is more that way (the parent must be `relative`).
   */
  placement: 'inline' | 'overlay'
  look?: PagerLook
  /** The inline pair's own classes (a negative margin into the tile's padding). */
  className?: string
  children?: ReactNode
}

// 16px tall, the line it sits on (a glance tile keeps its height), 14px wide; `before:` widens what a click hits by 6px a side.
const INLINE_BTN = 'relative grid h-4 w-3.5 shrink-0 place-items-center rounded-full before:absolute before:-inset-1.5 before:content-[""] text-fg-muted transition-colors duration-100 hover:bg-surface-hover hover:text-fg aria-disabled:cursor-default aria-disabled:bg-transparent aria-disabled:opacity-30 [&_svg]:h-3.5 [&_svg]:w-3.5'
// At an end the button stays mounted (a focused one keeps the focus, shown faint) but is invisible and lets clicks through.
const OVERLAY_BTN = 'absolute top-1/2 z-[1] grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface/90 text-fg-2 shadow-menu transition-[opacity,background-color] duration-100 hover:bg-surface-hover hover:text-fg aria-disabled:pointer-events-none aria-disabled:opacity-0 aria-disabled:focus-visible:opacity-40 [&_svg]:h-4 [&_svg]:w-4'
/** Touch keeps its swipe: the buttons are for a mouse or trackpad. The Games look hides itself in testGame.css (`.tg-pager-btn`). */
const TOUCH_HIDDEN = '[@media(pointer:coarse)]:hidden'

function overlayClass(look: PagerLook, side: 'left' | 'right'): string {
  if (look === 'games') return cx('tg-chevron-btn tg-pager-btn', side === 'left' ? 'left-1' : 'right-1')
  return cx(OVERLAY_BTN, TOUCH_HIDDEN, side === 'left' ? 'left-1' : 'right-1')
}

/**
 * Previous / next buttons for anything that scrolls sideways (THEME.md §5): a mouse
 * without a sideways wheel can't swipe. They show only on a mouse or trackpad
 * (`pointer: fine`); touch keeps its swipe. ←/→ on a button move too. A button at an
 * end is aria-disabled and stays mounted, so the keyboard focus is never lost.
 */
export function ScrollPager({ track, noun, paged = false, placement, look = 'app', className, children }: PagerProps) {
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
      <span className={cx('flex shrink-0 items-center', className)}>
        <button type="button" aria-label={prevLabel} title={prevLabel} aria-disabled={!edges.left} onClick={press(-1, edges.left)} onKeyDown={onKeyDown}
          className={cx(INLINE_BTN, TOUCH_HIDDEN)}>
          <ChevronLeft aria-hidden />
        </button>
        {children}
        <button type="button" aria-label={nextLabel} title={nextLabel} aria-disabled={!edges.right} onClick={press(1, edges.right)} onKeyDown={onKeyDown}
          className={cx(INLINE_BTN, TOUCH_HIDDEN)}>
          <ChevronRight aria-hidden />
        </button>
      </span>
    )
  }
  return (
    <>
      <button type="button" aria-label={prevLabel} title={prevLabel} aria-disabled={!edges.left} tabIndex={edges.left ? 0 : -1}
        onClick={press(-1, edges.left)} onKeyDown={onKeyDown} className={overlayClass(look, 'left')}>
        <ChevronLeft aria-hidden />
      </button>
      <button type="button" aria-label={nextLabel} title={nextLabel} aria-disabled={!edges.right} tabIndex={edges.right ? 0 : -1}
        onClick={press(1, edges.right)} onKeyDown={onKeyDown} className={overlayClass(look, 'right')}>
        <ChevronRight aria-hidden />
      </button>
    </>
  )
}

interface StripProps {
  /** For the buttons' names: "games" → "Previous games" / "Next games". */
  noun: string
  /** The track's own classes (flex, gap, padding, snap); it scrolls sideways with its bar hidden. */
  className?: string
  /** The wrapper's classes, when the strip is a flex child itself (`flex-1`). */
  wrapClassName?: string
  /** The track's element: `nav` for a list of sections. */
  as?: 'div' | 'nav'
  /** The track, for a caller that scrolls it itself (bringing the picked chip into view). */
  trackRef?: RefObject<HTMLElement | null>
  look?: PagerLook
  /** The track's role and name, when it has one (a tab list). */
  role?: string
  'aria-label'?: string
  children: ReactNode
}

/**
 * A row that scrolls sideways (a strip of cards, a row of chips) with ScrollPager's
 * buttons over its edges: swipe on touch, the buttons with a mouse.
 */
export function PagedStrip({ noun, className, wrapClassName, as: Track = 'div', trackRef, look = 'app', role, 'aria-label': ariaLabel, children }: StripProps) {
  const own = useRef<HTMLElement>(null)
  const track = trackRef ?? own
  const scroller = look === 'games' ? 'tg-scroll-x' : 'scrollbar-none overflow-x-auto overscroll-x-contain'
  return (
    <div className={cx('relative min-w-0', wrapClassName)}>
      <Track ref={track as RefObject<HTMLDivElement>} role={role} aria-label={ariaLabel} className={cx(scroller, className)}>
        {children}
      </Track>
      <ScrollPager track={track} noun={noun} placement="overlay" look={look} />
    </div>
  )
}
