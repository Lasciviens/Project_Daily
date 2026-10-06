import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent } from 'react'
import { clampWindowSize, resizeBy, type ResizeEdge, type WinSize } from './windowSize'

// Resizing the request window (tablet/desktop): its right edge, bottom edge
// and bottom-right corner drag. Like the move (useFloatingWindow) a drag
// writes the size straight to the element's style — nothing re-renders — and
// hands it to `onCommit` when it ends; the move hook's ResizeObserver then
// keeps the window on screen. A saved size is re-clamped when the screen
// changes; null = the view's own default (its CSS width, its natural height).

const viewport = (): WinSize => ({ w: window.innerWidth, h: window.innerHeight })

function apply(el: HTMLElement, size: WinSize | null) {
  el.style.width = size ? `${size.w}px` : ''
  el.style.height = size ? `${size.h}px` : ''
  el.style.maxHeight = size ? 'none' : ''
}

interface Options {
  enabled: boolean
  el: () => HTMLElement | null
  size: WinSize | null
  /** A resize starts: the window stops following the default corner. */
  onStart: (rect: DOMRect) => void
  onCommit: (size: WinSize) => void
}

export function useWindowResize({ enabled, el, size, onStart, onCommit }: Options) {
  const drag = useRef<{ edge: ResizeEdge; x: number; y: number; start: WinSize; last: WinSize } | null>(null)
  const w = size?.w, h = size?.h
  const current = useRef<WinSize | null>(null)
  // Disabled (a phone: the docked panel sizes itself) the element is never touched.
  const enabledRef = useRef(enabled)
  useLayoutEffect(() => { current.current = enabled && w && h ? { w, h } : null; enabledRef.current = enabled }, [enabled, w, h])
  /** The window element mounted (opened, restored): give it its saved size. */
  const attach = useCallback((node: HTMLElement | null) => {
    if (node && enabledRef.current) apply(node, current.current ? clampWindowSize(current.current, viewport()) : null)
  }, [])

  useLayoutEffect(() => {
    const node = el()
    if (!node || !enabled) return
    apply(node, w && h ? clampWindowSize({ w, h }, viewport()) : null)
  }, [enabled, w, h, el])

  useEffect(() => {
    if (!enabled || !w || !h) return
    const fit = () => { const node = el(); if (node) apply(node, clampWindowSize({ w, h }, viewport())) }
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [enabled, w, h, el])

  const handle = useCallback((edge: ResizeEdge) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      const node = el()
      if (!enabled || !node || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      onStart(node.getBoundingClientRect())
      const start = { w: node.offsetWidth, h: node.offsetHeight }
      drag.current = { edge, x: e.clientX, y: e.clientY, start, last: start }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      const node = el()
      if (!d || !node) return
      d.last = resizeBy(d.start, d.edge, e.clientX - d.x, e.clientY - d.y, viewport())
      apply(node, d.last)
    },
    onPointerUp: () => {
      const d = drag.current
      drag.current = null
      if (d && (d.last.w !== d.start.w || d.last.h !== d.start.h)) onCommit(d.last)
    },
    onPointerCancel: () => { drag.current = null },
  }), [enabled, el, onStart, onCommit])
  return { handle, attach }
}
