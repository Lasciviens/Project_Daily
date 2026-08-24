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
    // Real bug, fixed: this used to call e.currentTarget.setPointerCapture()
    // unconditionally, right here, on EVERY pointerdown — including one that
    // started on a nested interactive child (the checkbox, or any of the
    // ✎/↳/📋/⊘/✕ action buttons), since pointerdown bubbles up to this row's
    // handler regardless of which descendant it started on. Once a pointer
    // is captured, the browser retargets that pointer's subsequent
    // pointerup AND the click it synthesizes to the CAPTURING element (this
    // row) — never wherever the pointer physically is — so a plain tap on
    // any button inside the row fired the ROW's own onClick (open edit)
    // instead of the button's: the checkbox never toggled, Delete never
    // deleted, every action silently became "open edit". Capture is now
    // deferred to onPointerMove, and only once a genuine horizontal swipe is
    // confirmed (axisLocked === 'x') — a plain tap never moves enough to
    // reach that branch, so its click reaches its real target untouched;
    // only an actual swipe gesture ever captures the pointer.
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
      if (axisLocked.current === 'x') {
        // NOW it's a confirmed horizontal swipe — capture so a fast
        // real-finger swipe that carries the pointer outside the row's
        // bounds mid-gesture still reaches this handler (and the
        // pointerup/pointercancel that finalizes open/closed state)
        // instead of getting stuck. Never reached by a plain tap/click.
        e.currentTarget.setPointerCapture(e.pointerId)
      }
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
