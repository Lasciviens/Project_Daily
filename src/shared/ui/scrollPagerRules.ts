// The pure half of ScrollPager and useScrollEdges (THEME.md §5): which ways a
// horizontal track can still go, and how far one press moves it.
// `verify-scroll-pager` tests these.

export interface ScrollEdges {
  /** There is more to the left. */
  left: boolean
  /** There is more to the right. */
  right: boolean
}

/** A pixel of slack: a fractional scroll position never leaves a button showing at the end. */
const SLACK = 1

export function scrollEdges(scrollLeft: number, width: number, scrollWidth: number): ScrollEdges {
  return { left: scrollLeft > SLACK, right: scrollLeft + width < scrollWidth - SLACK }
}

/**
 * How far one press moves the track. A paged track (a glance tile's screens) moves one
 * whole screen; a strip of cards moves 80 % of its view, so the card cut at the edge
 * stays in sight after the move.
 */
export function pageStep(width: number, paged: boolean): number {
  return paged ? width : Math.max(1, Math.round(width * 0.8))
}
