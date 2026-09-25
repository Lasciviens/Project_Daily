import { useEffect, useMemo, useRef, useState } from 'react'

// Bookcase geometry for TgShelf, plus the two small DOM hooks the three game
// views share (element size, reveal the selected card).

/** Row padding either side of the covers: room for the carousel chevrons. */
export const SHELF_SIDE = 44
/** Headroom between a shelf's ceiling lamps and the tops of its covers. */
export const SHELF_CEIL = 22
/**
 * The plank's front face under the covers: TgGameCard's title (mt-2 + 18px
 * line) and meta row (mt-1 + 16px line) plus 14px below. The row's covers
 * stand exactly on the plank's lit top edge because of this number.
 */
export const SHELF_LABEL = 60

const CHROME = SHELF_CEIL + SHELF_LABEL
const MIN_COVER = 132
const MAX_COVER = 200
/** Slot width per cover height: a 0.72 case plus a hair of room for its title. */
const SLOT_PER_COVER = 0.78
/** The design spaces its cases about 0.4 of a slot apart. */
const GAP_PER_SLOT = 0.4
const MIN_ROWS = 2
const MAX_ROWS = 5

export interface ShelfLayout {
  cols: number
  rows: number
  slotWidth: number
  coverHeight: number
  gap: number
  /** Height of one shelf; the rows split the case's height evenly. */
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
 * Pure: the bookcase for a `width` × `height` case.
 *
 * Cover height is bounded by the height first (two shelves must fit — the
 * design never shows fewer), then grows into whatever spare height the chosen
 * row count leaves. Columns come from the width: when the width is the limit
 * the covers shrink a little rather than drop a column; when the height is the
 * limit the spare width goes between the cases, like a real bookcase.
 */
export function shelfGeometry(width: number, height: number): ShelfLayout {
  const inner = Math.max(0, width - 2 * SHELF_SIDE)
  const byHeight = Math.floor(height / MIN_ROWS) - CHROME
  let cover = clamp(Math.min(Math.round(inner * 0.2), byHeight), MIN_COVER, MAX_COVER)
  const rows = clamp(Math.floor(height / (cover + CHROME)), MIN_ROWS, MAX_ROWS)
  cover = clamp(Math.floor(height / rows) - CHROME, cover, Math.min(MAX_COVER, Math.round(cover * 1.3)))

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

  // Short containers keep full-size shelves and scroll — covers never squash.
  const rowHeight = Math.max(cover + CHROME, Math.floor(height / rows))
  return { cols, rows, slotWidth: slot, coverHeight: cover, gap, rowHeight, measured: true }
}

/**
 * The element's size, from a ResizeObserver. `border` measures the border box
 * (scrollbar included), so a scrollbar appearing can't feed back into a layout
 * that makes it disappear again.
 */
export function useElementSize(el: HTMLElement | null, box: 'content' | 'border' = 'content'): ElementSize | null {
  const [size, setSize] = useState<ElementSize | null>(null)
  useEffect(() => {
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const b = box === 'border' ? entry.borderBoxSize?.[0] : undefined
      const w = Math.round(b ? b.inlineSize : box === 'border' ? el.offsetWidth : entry.contentRect.width)
      const h = Math.round(b ? b.blockSize : box === 'border' ? el.offsetHeight : entry.contentRect.height)
      setSize(prev => (prev && prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [el, box])
  return size
}

export function useShelfLayout(el: HTMLElement | null): ShelfLayout {
  const size = useElementSize(el, 'border')
  return useMemo(
    () => (size ? shelfGeometry(size.w, size.h) : { ...shelfGeometry(800, 490), measured: false }),
    [size],
  )
}

/**
 * Scrolls the card for `id` (a `[data-game-id]` inside `root`) into view
 * whenever the id or `revealKey` changes — `revealKey` should change only when
 * the card may have moved (a re-chunk, a filter), not on every refetch, or a
 * row the user scrolled away would snap back. First reveal is instant.
 */
export function useRevealCard(root: HTMLElement | null, id: string | null, revealKey: string | null): void {
  const revealed = useRef(false)
  useEffect(() => {
    if (!root || !id || revealKey == null) return
    const card = root.querySelector<HTMLElement>(`[data-game-id="${CSS.escape(id)}"]`)
    if (!card) return
    card.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: revealed.current ? smoothScroll() : 'auto' })
    revealed.current = true
  }, [root, id, revealKey])
}
