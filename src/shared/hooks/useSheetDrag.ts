import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

// Drag-down-to-close for a phone bottom sheet (ModalShell, the page sheets). The grab handle and title
// row drag with pointer events (`touch-action: none` there, so the browser
// never claims the gesture); the scrolling body drags only while it sits at
// its top and the finger moves down, through a non-passive touch listener
// that can cancel the native overscroll — scrolling a scrolled list is never
// hijacked. Release past a distance threshold, or a quick flick, closes;
// anything else springs back.
//
// The panel and backdrop move through their own style properties, never
// through React state: a drag re-renders nothing, however heavy the sheet's
// content (it used to re-render the whole sheet on every pointer move).

const SLOP = 6 // px before a body touch counts as a drag
const CLOSE_FRACTION = 0.25
const CLOSE_MAX_PX = 140
const FLICK_PX_PER_MS = 0.55
const SETTLE_MS = 220

interface Track { startY: number; lastY: number; lastT: number; v: number }

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function useSheetDrag(open: boolean, onClose: () => void) {
  // The panel lives in a ref for the style writes and in state so the effects
  // re-run when the Dialog remounts it.
  const panelRef = useRef<HTMLElement | null>(null)
  const [panelEl, setPanelElState] = useState<HTMLElement | null>(null)
  const setPanelEl = useCallback((el: HTMLElement | null) => { panelRef.current = el; setPanelElState(el) }, [])
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null)
  const backdropRef = useRef<HTMLDivElement | null>(null)
  const track = useRef<Track | null>(null)
  const offsetRef = useRef(0)
  const heightRef = useRef(400)
  const settleTimer = useRef(0)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  /** Drops every inline style a drag left, handing the panel back to its CSS transitions. */
  const clear = () => {
    window.clearTimeout(settleTimer.current)
    offsetRef.current = 0
    for (const el of [panelRef.current, backdropRef.current]) {
      if (!el) continue
      el.style.removeProperty('transform')
      el.style.removeProperty('transition')
      el.style.removeProperty('opacity')
    }
  }

  const paint = (px: number, dragging: boolean) => {
    offsetRef.current = px
    const settle = reducedMotion() ? 'none' : `transform ${SETTLE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)`
    const p = panelRef.current
    if (p) {
      p.style.transition = dragging ? 'none' : settle
      p.style.transform = `translateY(${px}px)`
    }
    const b = backdropRef.current
    if (b) {
      b.style.transition = dragging ? 'none' : `opacity ${SETTLE_MS}ms ease-out`
      b.style.opacity = String(Math.max(0, 1 - px / heightRef.current))
    }
  }

  // A reopened (or remounted) sheet starts at rest.
  useEffect(() => {
    if (!open) return
    track.current = null
    clear()
    // panelEl is here so a remounted panel is reset too.
  }, [open, panelEl])
  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  const begin = (y: number) => {
    window.clearTimeout(settleTimer.current)
    heightRef.current = panelRef.current?.offsetHeight || 400
    track.current = { startY: y - offsetRef.current, lastY: y, lastT: performance.now(), v: 0 }
  }
  const move = (y: number) => {
    const t = track.current
    if (!t) return
    const now = performance.now()
    const dt = Math.max(1, now - t.lastT)
    t.v = 0.6 * ((y - t.lastY) / dt) + 0.4 * t.v
    t.lastY = y; t.lastT = now
    paint(Math.max(0, y - t.startY), true)
  }
  const end = () => {
    const t = track.current
    track.current = null
    if (!t) return
    const height = heightRef.current
    const d = offsetRef.current
    if (d > Math.min(CLOSE_MAX_PX, height * CLOSE_FRACTION) || (t.v > FLICK_PX_PER_MS && d > 16)) {
      paint(height, false) // stays off-screen while the Dialog runs its leave transition
      closeRef.current()
    } else if (d > 0) {
      paint(0, false)
      settleTimer.current = window.setTimeout(clear, SETTLE_MS + 30)
    } else {
      clear()
    }
  }

  // Body: only from its top, only downwards.
  useEffect(() => {
    if (!bodyEl) return
    let y0: number | null = null
    let active = false
    const onStart = (e: TouchEvent) => {
      active = false
      y0 = e.touches.length === 1 && bodyEl.scrollTop <= 0 ? e.touches[0].clientY : null
    }
    const onMove = (e: TouchEvent) => {
      if (y0 == null) return
      const y = e.touches[0].clientY
      if (!active) {
        if (y - y0 < -2) { y0 = null; return } // scrolling the list up: not ours
        if (y - y0 < SLOP || bodyEl.scrollTop > 0) return
        active = true
        begin(y)
      }
      e.preventDefault()
      move(y)
    }
    const onEnd = () => { if (active) end(); active = false; y0 = null }
    bodyEl.addEventListener('touchstart', onStart, { passive: true })
    bodyEl.addEventListener('touchmove', onMove, { passive: false })
    bodyEl.addEventListener('touchend', onEnd)
    bodyEl.addEventListener('touchcancel', onEnd)
    return () => {
      bodyEl.removeEventListener('touchstart', onStart)
      bodyEl.removeEventListener('touchmove', onMove)
      bodyEl.removeEventListener('touchend', onEnd)
      bodyEl.removeEventListener('touchcancel', onEnd)
    }
    // begin/move/end only touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyEl])

  // Handle + title row. A press on a control there (Reset) stays a click:
  // the pointer is only captured once it has really moved.
  const handleProps = {
    style: { touchAction: 'none' } as CSSProperties,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button, a, input')) return
      begin(e.clientY)
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!track.current) return
      if (!e.currentTarget.hasPointerCapture(e.pointerId) && Math.abs(e.clientY - track.current.lastY) > 2) {
        e.currentTarget.setPointerCapture(e.pointerId)
      }
      move(e.clientY)
    },
    onPointerUp: end,
    onPointerCancel: end,
  }

  return { setPanelEl, setBodyEl, backdropRef, handleProps }
}
