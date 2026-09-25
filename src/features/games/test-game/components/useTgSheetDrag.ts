import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

// Drag-down-to-close for the phone bottom sheet. The grab handle and title
// row drag with pointer events (`touch-action: none` there, so the browser
// never claims the gesture); the scrolling body drags only while it sits at
// its top and the finger moves down, through a non-passive touch listener
// that can cancel the native overscroll — scrolling a scrolled list is never
// hijacked. Release past a distance threshold, or a quick flick, closes;
// anything else springs back.

const SLOP = 6 // px before a body touch counts as a drag
const CLOSE_FRACTION = 0.25
const CLOSE_MAX_PX = 140
const FLICK_PX_PER_MS = 0.55

interface Track { startY: number; lastY: number; lastT: number; v: number }

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function useTgSheetDrag(open: boolean, onClose: () => void) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null)
  const [bodyEl, setBodyEl] = useState<HTMLElement | null>(null)
  const track = useRef<Track | null>(null)
  const offsetRef = useRef(0)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])

  // A reopened sheet starts back at rest (adjusting state during render).
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setOffset(0); setDragging(false) }
  }

  const apply = (px: number) => { offsetRef.current = px; setOffset(px) }
  const begin = (y: number) => {
    track.current = { startY: y - offsetRef.current, lastY: y, lastT: performance.now(), v: 0 }
    setDragging(true)
  }
  const move = (y: number) => {
    const t = track.current
    if (!t) return
    const now = performance.now()
    const dt = Math.max(1, now - t.lastT)
    t.v = 0.6 * ((y - t.lastY) / dt) + 0.4 * t.v
    t.lastY = y; t.lastT = now
    apply(Math.max(0, y - t.startY))
  }
  const end = () => {
    const t = track.current
    track.current = null
    setDragging(false)
    if (!t) return
    const height = panelEl?.offsetHeight ?? 400
    const d = offsetRef.current
    if (d > Math.min(CLOSE_MAX_PX, height * CLOSE_FRACTION) || (t.v > FLICK_PX_PER_MS && d > 16)) {
      apply(height) // stays off-screen while the Dialog runs its leave transition
      closeRef.current()
    } else {
      apply(0)
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
    // begin/move/end only touch refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyEl, panelEl])

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

  const height = panelEl?.offsetHeight || 1
  const settle = reducedMotion() ? 'none' : 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)'
  const panelStyle: CSSProperties | undefined = offset || dragging
    ? { transform: `translateY(${offset}px)`, transition: dragging ? 'none' : settle }
    : undefined
  const backdropStyle: CSSProperties | undefined = offset
    ? { opacity: Math.max(0, 1 - offset / height), transition: dragging ? 'none' : undefined }
    : undefined

  return { setPanelEl, setBodyEl, handleProps, panelStyle, backdropStyle }
}
