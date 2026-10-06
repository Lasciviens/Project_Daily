// Pure: the request window's size on tablet/desktop — dragged from its right
// edge, bottom edge or bottom-right corner, kept between a minimum and the
// screen (minus a margin), re-checked when the screen changes. The request
// and the prompt each keep their own size (the prompt opens wider).
// Import-free so scripts/verify-dev-request-context.cjs can require it.

export interface WinSize { w: number; h: number }
export type ResizeEdge = 'e' | 's' | 'se'

export const MIN_WINDOW: WinSize = { w: 360, h: 420 }

/** A size inside [MIN_WINDOW, viewport − 2 × margin]; a screen smaller than the minimum wins. */
export function clampWindowSize(size: WinSize, viewport: WinSize, margin = 8): WinSize {
  const maxW = Math.max(0, viewport.w - margin * 2)
  const maxH = Math.max(0, viewport.h - margin * 2)
  return {
    w: Math.round(Math.min(Math.max(size.w, Math.min(MIN_WINDOW.w, maxW)), maxW)),
    h: Math.round(Math.min(Math.max(size.h, Math.min(MIN_WINDOW.h, maxH)), maxH)),
  }
}

/** The size after dragging `edge` by (dx, dy) from `start`, clamped. */
export function resizeBy(start: WinSize, edge: ResizeEdge, dx: number, dy: number, viewport: WinSize, margin = 8): WinSize {
  return clampWindowSize({
    w: edge === 's' ? start.w : start.w + dx,
    h: edge === 'e' ? start.h : start.h + dy,
  }, viewport, margin)
}

/** A stored size read back (localStorage): null unless two finite, positive numbers. */
export function readWindowSize(v: unknown): WinSize | null {
  if (typeof v !== 'object' || v === null) return null
  const { w, h } = v as Record<string, unknown>
  return typeof w === 'number' && typeof h === 'number' && Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0
    ? { w: Math.round(w), h: Math.round(h) }
    : null
}
