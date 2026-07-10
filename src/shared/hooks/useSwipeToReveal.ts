import { useRef, useState, useCallback } from 'react'

const REVEAL_PX  = 76   // matches the delete panel's rendered width
const OPEN_AT_PX = 40   // drag past this and releasing snaps open, not closed

// Native iOS-style "swipe left to reveal a delete button" for a list row.
// Hand-rolled Pointer Events rather than a gesture library (e.g.
// @use-gesture/react) — this app's stack rule is "no animation library" and
// a single-axis swipe-then-clamp is a small enough gesture to track by hand;
// CSS handles the snap-open/closed transition, no JS animation loop needed.
// Returns props to spread on the swipeable row plus `isOpen`/`close` so the
// delete button (rendered by the caller, behind the row) can close itself
// after acting.
export function useSwipeToReveal() {
  const [dragX, setDragX]   = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const startX = useRef<number | null>(null)
  const startY = useRef(0)
  const axisLocked = useRef<'x' | 'y' | null>(null)

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    startX.current = e.clientX
    startY.current = e.clientY
    axisLocked.current = null
    setDragging(true)
    // Without this, a fast real-finger swipe (routine on an actual device,
    // rare in a slow simulated drag) can move the pointer outside this
    // row's bounds mid-gesture — pointer events without capture are
    // re-hit-tested on every move, so they'd stop reaching this element
    // entirely and the row could get stuck mid-drag, never receiving the
    // pointerup that finalizes open/closed state.
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (startX.current == null) return
    const dx = e.clientX - startX.current
    const dy = e.clientY - startY.current

    // Lock to whichever axis moved first — once locked to 'y' this gesture
    // gets out of the way entirely so the page scrolls normally.
    if (!axisLocked.current) {
      if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
      axisLocked.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (axisLocked.current === 'y') return

    e.preventDefault()
    const base = isOpen ? -REVEAL_PX : 0
    const next = Math.min(0, Math.max(-REVEAL_PX, base + dx))
    setDragX(next)
  }, [isOpen])

  const endDrag = useCallback(() => {
    if (startX.current == null) return
    startX.current = null
    setDragging(false)
    if (axisLocked.current !== 'x') { axisLocked.current = null; return }
    axisLocked.current = null
    const open = Math.abs(dragX) >= OPEN_AT_PX
    setIsOpen(open)
    if (!open) setDragX(0)
  }, [dragX])

  const close = useCallback(() => { setIsOpen(false); setDragX(0) }, [])

  return {
    isOpen,
    close,
    rowProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      style: {
        transform: `translateX(${isOpen && !dragging ? -REVEAL_PX : dragX}px)`,
        transition: dragging ? 'none' : 'transform 180ms ease-out',
        touchAction: 'pan-y',
      } as React.CSSProperties,
    },
  }
}
