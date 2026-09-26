import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'

// Bookcase geometry for TgShelf (and its loading skeleton), plus the two small
// DOM hooks the three game views share (element size, reveal the selected card).

/** Case padding either side of the outer columns. */
export const SHELF_SIDE = 28
/** Headroom between a shelf's ceiling lamps and the tops of its covers. */
export const SHELF_CEIL = 22
/**
 * The plank's front face under the covers: TgGameCard's title (mt-2 + 18px
 * line) and meta row (mt-1 + 16px line) plus 14px below. The covers stand
 * exactly on the plank's lit top edge because of this number (.tg-case paints
 * the plank as the bottom SHELF_LABEL px of every row).
 */
export const SHELF_LABEL = 60

const CHROME = SHELF_CEIL + SHELF_LABEL
const MIN_COVER = 132
const MAX_COVER = 184
/**
 * Cover height the case aims for: with the detail panel as an overlay the
 * shelf spans the whole main column, and this gives ~7 columns on a laptop
 * and ~11 on a 2450px monitor, two to four shelves tall.
 */
const PREF_COVER = 168
/** Slot width per cover height: a 0.72 case plus a hair of room for its title. */
const SLOT_PER_COVER = 0.78
/** The design spaces its cases about 0.4 of a slot apart. */
const GAP_PER_SLOT = 0.4
/** Title/meta inset per cover height: a 0.7 case centred in its 0.78 slot. */
const CASE_ASPECT = 0.7
const MIN_ROWS = 2
/** Extra headroom per cover height a shelf may take to fill the view evenly. */
const MAX_SLACK = 0.12

export interface ShelfLayout {
  /** Cases per shelf: the case is a row-major grid of this many columns. */
  cols: number
  /** Shelves it takes to fill the visible height; spare, empty ones fill it. */
  rows: number
  slotWidth: number
  coverHeight: number
  gap: number
  /** Height of one shelf: cover + chrome, or an even split of the view when close. */
  rowHeight: number
  /** False until the container has been measured once. */
  measured: boolean
}

export interface ElementSize { w: number; h: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** 'smooth', unless the viewer asked for reduced motion (CSS can't reach JS scrolls). */
export function smoothScroll(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

/**
 * Pure: the bookcase for a `width` × `height` view. The case scrolls
 * vertically; nothing scrolls sideways.
 *
 * Covers are sized so a whole number of shelves (two or more) would fill the
 * height, within MIN_COVER…MAX_COVER. Columns come from the width: when the
 * width is the limit the covers shrink a little rather than drop a column;
 * otherwise the spare width goes between the cases, like a real bookcase.
 * A shelf stays tight around its covers (lamps just above them, like the
 * design) unless an even split of the view is only a little taller — then the
 * view ends exactly on a plank.
 */
export function shelfGeometry(width: number, height: number): ShelfLayout {
  const inner = Math.max(0, width - 2 * SHELF_SIDE)
  const fit = Math.max(MIN_ROWS, Math.floor(height / (PREF_COVER + CHROME)))
  let cover = clamp(Math.floor(height / fit) - CHROME, MIN_COVER, MAX_COVER)

  let slot = Math.round(cover * SLOT_PER_COVER)
  const gapTarget = Math.round(slot * GAP_PER_SLOT)
  const cols = Math.max(1, Math.round((inner + gapTarget) / (slot + gapTarget)))
  const fitted = Math.floor((inner - (cols - 1) * gapTarget) / cols)
  let gap = gapTarget
  if (fitted < slot) {
    slot = Math.max(1, fitted)
    cover = Math.min(cover, Math.floor(slot / SLOT_PER_COVER))
  } else if (cols > 1) {
    gap = Math.min(Math.round(gapTarget * 1.8), Math.floor((inner - cols * slot) / (cols - 1)))
  }

  // Short views keep full-size shelves and scroll — covers never squash.
  const tight = cover + CHROME
  const even = Math.floor(height / fit)
  const rowHeight = even >= tight && even - tight <= Math.round(cover * MAX_SLACK) ? even : tight
  const rows = Math.max(MIN_ROWS, Math.ceil(height / rowHeight))
  return { cols, rows, slotWidth: slot, coverHeight: cover, gap, rowHeight, measured: true }
}

/** Title/meta side inset that lines the text up with a boxed cover's left edge. */
export function textInset(layout: ShelfLayout): number {
  return Math.max(0, Math.round((layout.slotWidth - layout.coverHeight * CASE_ASPECT) / 2))
}

/**
 * The case geometry as the CSS custom properties .tg-case, .tg-slot and
 * TgGameCard read — set once on the case, so a resize restyles every slot and
 * re-renders no card.
 */
export function shelfVars(layout: ShelfLayout): Record<string, string> {
  return {
    '--tg-cols': String(layout.cols),
    '--tg-side': `${SHELF_SIDE}px`,
    '--tg-card-w': `${layout.slotWidth}px`,
    '--tg-cover-h': `${layout.coverHeight}px`,
    '--tg-gap': `${layout.gap}px`,
    '--tg-half-gap': `${layout.gap / 2}px`,
    '--tg-row-h': `${layout.rowHeight}px`,
    '--tg-text-inset': `${textInset(layout)}px`,
    '--tg-text-overhang': `${Math.max(0, Math.min(12, Math.floor(layout.gap / 2) - 2))}px`,
  }
}

/**
 * The element's size, from a ResizeObserver. `border` measures the border box
 * (scrollbar included), so a scrollbar appearing can't feed back into a layout
 * that makes it disappear again.
 */
export function useElementSize(el: HTMLElement | null, box: 'content' | 'border' = 'content'): ElementSize | null {
  const store = useMemo(() => (el ? sizeStore(el, box) : null), [el, box])
  return useSyncExternalStore(store ? store.subscribe : noSubscribe, store ? store.get : noSize, noSize)
}

const noSubscribe = () => () => {}
const noSize = () => null

/**
 * An element's size as an external store: read synchronously on first use —
 * the element is mounted by then, so the shelf is laid out before the first
 * paint instead of painting an empty frame and waiting for the observer —
 * then kept current by a ResizeObserver.
 */
function sizeStore(el: HTMLElement, box: 'content' | 'border') {
  let size: ElementSize | null = null
  const set = (w: number, h: number) => {
    w = Math.round(w); h = Math.round(h)
    if (size && size.w === w && size.h === h) return false
    size = { w, h }
    return true
  }
  const read = () => {
    if (box === 'border') return set(el.offsetWidth, el.offsetHeight)
    const cs = getComputedStyle(el)
    const px = (v: string) => parseFloat(v) || 0
    return set(el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight), el.clientHeight - px(cs.paddingTop) - px(cs.paddingBottom))
  }
  return {
    get: () => { if (!size) read(); return size },
    subscribe: (onChange: () => void) => {
      const ro = new ResizeObserver(([entry]) => {
        const b = box === 'border' ? entry.borderBoxSize?.[0] : undefined
        const changed = b
          ? set(b.inlineSize, b.blockSize)
          : box === 'border' ? set(el.offsetWidth, el.offsetHeight) : set(entry.contentRect.width, entry.contentRect.height)
        if (changed) onChange()
      })
      ro.observe(el)
      return () => ro.disconnect()
    },
  }
}

/**
 * `el` is the case's vertical scroller, with `scrollbar-gutter: stable` so its
 * content width never changes as a scrollbar comes and goes (which would feed
 * back into the column count).
 */
export function useShelfLayout(el: HTMLElement | null): ShelfLayout {
  const size = useElementSize(el, 'content')
  return useMemo(
    () => (size ? shelfGeometry(size.w, size.h) : { ...shelfGeometry(1200, 490), measured: false }),
    [size],
  )
}

/**
 * Scrolls the card for `id` (a `[data-game-id]` inside `root`) into view once
 * per selection: when the id changes, or when `revealKey` first becomes
 * non-null (the view is ready). A resize, a re-chunk or a library arriving
 * never scrolls on its own — a user who scrolled away to browse stays put.
 *
 * `retryKey` covers a selected card that was not in the DOM yet (its library
 * still loading): each change of it looks again until the card is found once.
 * First reveal is instant, later ones smooth.
 */
export function useRevealCard(root: HTMLElement | null, id: string | null, revealKey: string | null, retryKey?: unknown): void {
  const revealed = useRef(false)
  const doneFor = useRef<string | null>(null)
  useEffect(() => {
    if (!root || !id || revealKey == null) return
    const key = `${revealKey}\u0000${id}`
    if (doneFor.current === key) return
    const card = root.querySelector<HTMLElement>(`[data-game-id="${CSS.escape(id)}"]`)
    if (!card) return
    card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: revealed.current ? smoothScroll() : 'auto' })
    revealed.current = true
    doneFor.current = key
  }, [root, id, revealKey, retryKey])
}
