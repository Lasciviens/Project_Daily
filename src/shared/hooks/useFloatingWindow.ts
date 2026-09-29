import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'

// A small non-modal window the user can drag anywhere and that always stays
// on screen (the request composer). Dragging writes left/top straight to the
// element's style — no React state, so a drag re-renders nothing (the
// useSheetDrag approach). The position is kept inside the viewport with a
// margin, re-checked when the window or the viewport changes size, and
// handed to `onCommit` when a move ends so the caller can persist it.

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }

/** Keeps a window of `size` fully inside `viewport`, `margin` px from every edge. */
export function clampPosition(pos: Point, size: Size, viewport: Size, margin = 8): Point {
  const maxX = Math.max(margin, viewport.w - size.w - margin)
  const maxY = Math.max(margin, viewport.h - size.h - margin)
  return {
    x: Math.round(Math.min(Math.max(pos.x, margin), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, margin), maxY)),
  }
}

/** The default spot: the bottom-right corner, `inset` px in. */
export function cornerPosition(size: Size, viewport: Size, inset = 24): Point {
  return clampPosition({ x: viewport.w - size.w - inset, y: viewport.h - size.h - inset }, size, viewport)
}

/** Alt+Arrow nudges: 16px, 64px with Shift. Null for any other key. */
export function nudgeFor(key: string, shift: boolean): Point | null {
  const step = shift ? 64 : 16
  switch (key) {
    case 'ArrowLeft': return { x: -step, y: 0 }
    case 'ArrowRight': return { x: step, y: 0 }
    case 'ArrowUp': return { x: 0, y: -step }
    case 'ArrowDown': return { x: 0, y: step }
    default: return null
  }
}

const SLOP = 3

interface Options {
  enabled: boolean
  /** Saved position, or null for the default corner. */
  position: Point | null
  onCommit: (pos: Point) => void
  margin?: number
}

export function useFloatingWindow({ enabled, position, onCommit, margin = 8 }: Options) {
  const elRef = useRef<HTMLElement | null>(null)
  const posRef = useRef<Point | null>(null)
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null)
  const commitRef = useRef(onCommit)
  useEffect(() => { commitRef.current = onCommit }, [onCommit])
  const savedRef = useRef(position)
  useEffect(() => { savedRef.current = position }, [position])

  const viewport = (): Size => ({ w: window.innerWidth, h: window.innerHeight })
  const size = (): Size => {
    const el = elRef.current
    return el ? { w: el.offsetWidth, h: el.offsetHeight } : { w: 0, h: 0 }
  }
  const paint = useCallback((p: Point) => {
    posRef.current = p
    const el = elRef.current
    if (!el) return
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
    el.style.visibility = 'visible'
  }, [])
  // Until the user places the window (drag, nudge, or a saved spot) it keeps
  // to the corner as its size changes; after that it only stays on screen.
  const userPlaced = useRef(false)
  const place = useCallback(() => {
    if (!elRef.current) return
    const s = size()
    if (!userPlaced.current && savedRef.current) { userPlaced.current = true; posRef.current = savedRef.current }
    paint(userPlaced.current && posRef.current ? clampPosition(posRef.current, s, viewport(), margin) : cornerPosition(s, viewport()))
  }, [paint, margin])

  const setWindowEl = useCallback((el: HTMLElement | null) => {
    elRef.current = el
    if (el) place()
  }, [place])

  // First placement before paint, then keep it on screen as sizes change.
  useLayoutEffect(() => { if (enabled) place() }, [enabled, place])
  useEffect(() => {
    if (!enabled) return
    const el = elRef.current
    const ro = typeof ResizeObserver !== 'undefined' && el ? new ResizeObserver(() => place()) : null
    if (ro && el) ro.observe(el)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
    }
  }, [enabled, place])

  const commit = () => { if (posRef.current) commitRef.current(posRef.current) }

  // The title bar drags. Presses on its buttons are left alone (they stay
  // clicks); anywhere else the pointer is captured at once, so a fast drag
  // that leaves the bar on its first move still carries the window.
  const handleProps = {
    style: { touchAction: 'none', cursor: 'grab' } as CSSProperties,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (!enabled || e.button !== 0 || (e.target as HTMLElement).closest('button, a, input, select, textarea, [role="tab"]')) return
      const p = posRef.current ?? { x: 0, y: 0 }
      drag.current = { dx: e.clientX - p.x, dy: e.clientY - p.y, startX: e.clientX, startY: e.clientY, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d) return
      if (!d.moved) {
        if (Math.abs(e.clientX - d.startX) < SLOP && Math.abs(e.clientY - d.startY) < SLOP) return
        d.moved = true
        userPlaced.current = true
      }
      paint(clampPosition({ x: e.clientX - d.dx, y: e.clientY - d.dy }, size(), viewport(), margin))
    },
    onPointerUp: () => {
      const moved = drag.current?.moved
      drag.current = null
      if (moved) commit()
    },
    onPointerCancel: () => { drag.current = null },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!enabled || !e.altKey) return
      const n = nudgeFor(e.key, e.shiftKey)
      if (!n) return
      e.preventDefault()
      userPlaced.current = true
      const p = posRef.current ?? { x: 0, y: 0 }
      paint(clampPosition({ x: p.x + n.x, y: p.y + n.y }, size(), viewport(), margin))
      commit()
    },
  }

  /** Back to the default corner (and forget the saved spot). */
  const resetPosition = useCallback(() => {
    posRef.current = null
    savedRef.current = null
    userPlaced.current = false
    place()
  }, [place])

  return { setWindowEl, handleProps, resetPosition }
}
