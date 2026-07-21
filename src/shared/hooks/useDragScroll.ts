import { useRef, useCallback } from 'react'

// Desktop drag-to-scroll for horizontal snap strips: mouse users can't swipe,
// and hidden scrollbars leave shift+wheel as the only (undiscoverable) way to
// move a strip. Attach the returned props to the scroll container — hold and
// drag scrolls it; a small movement threshold keeps ordinary clicks on cards/
// buttons inside the strip working. Touch input is ignored entirely (native
// swipe already handles it, and fighting it would break momentum scrolling).
export function useDragScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const state = useRef({ down: false, dragging: false, startX: 0, startLeft: 0 })

  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || !ref.current) return
    state.current = { down: true, dragging: false, startX: e.clientX, startLeft: ref.current.scrollLeft }
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const s = state.current
    if (!s.down || !ref.current) return
    const dx = e.clientX - s.startX
    if (!s.dragging && Math.abs(dx) < 5) return // click threshold
    if (!s.dragging) {
      s.dragging = true
      ref.current.setPointerCapture(e.pointerId)
    }
    ref.current.scrollLeft = s.startLeft - dx
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<T>) => {
    const s = state.current
    if (s.dragging && ref.current?.hasPointerCapture(e.pointerId)) {
      ref.current.releasePointerCapture(e.pointerId)
    }
    state.current = { down: false, dragging: false, startX: 0, startLeft: 0 }
  }, [])

  // Suppress the click that follows a drag so releasing over a card doesn't
  // activate it.
  const onClickCapture = useCallback((e: React.MouseEvent<T>) => {
    if (state.current.dragging) { e.preventDefault(); e.stopPropagation() }
  }, [])

  return {
    ref,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClickCapture,
    className: 'md:cursor-grab md:active:cursor-grabbing',
  }
}
