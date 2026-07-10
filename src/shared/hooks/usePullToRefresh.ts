import { useRef, useState, useCallback, useEffect } from 'react'

const MAX_PULL  = 88   // visual cap on how far the indicator travels
const THRESHOLD = 64   // release past this distance to trigger onRefresh

// Native "pull down at the top of the page to refresh" gesture — hand-rolled
// (no maintained small library exists for this in 2026; the few that do are
// either abandoned or awkward to reconcile with Tailwind-styled content) via
// touch events + a resistance curve, not CSS `overscroll-behavior` alone,
// since that alone doesn't give a controllable visual indicator or a hook to
// run `onRefresh` — it only suppresses the browser's own native bounce.
//
// Checks `window.scrollY` (not a local container's scrollTop) since most
// pages in this app scroll at the document level rather than inside their
// own overflow container — this only arms the gesture when the whole page
// is scrolled to the very top, same as a native pull-to-refresh.
//
// Listeners are attached via a native (non-React) addEventListener with
// `{ passive: false }`, NOT React's onTouchStart/onTouchMove JSX props —
// React attaches touch listeners as passive by default (for scroll perf),
// which silently no-ops any preventDefault() call inside them. Without a
// real preventDefault, a real phone's own rubber-band/scroll can visually
// fight this gesture even though the JS state updates still technically
// run — this was reported as "doesn't work" on a real device despite the
// logic checking out fine under simulated (CDP-dispatched) touch events.
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Refs mirroring state so the native listeners (attached once) always see
  // current values without needing to re-attach on every state change.
  const pullDistanceRef = useRef(0)
  const isRefreshingRef = useRef(false)

  const runRefresh = useCallback(async () => {
    setIsRefreshing(true)
    isRefreshingRef.current = true
    try {
      await onRefresh()
    } finally {
      setIsRefreshing(false)
      isRefreshingRef.current = false
    }
  }, [onRefresh])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    function onTouchStart(e: TouchEvent) {
      // A couple of px of tolerance — mobile browsers can report a
      // sub-pixel non-zero scrollY at rest (dynamic toolbar, rounding).
      if (window.scrollY <= 2 && !isRefreshingRef.current) {
        startY.current = e.touches[0].clientY
        draggingRef.current = true
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (startY.current == null || window.scrollY > 2) return
      const raw = e.touches[0].clientY - startY.current
      if (raw <= 0) { setPullDistance(0); pullDistanceRef.current = 0; return }
      // Only now — once this is genuinely a downward pull at the top of the
      // page — do we take over the gesture from the browser's own scroll/
      // bounce. Needs the non-passive listener below to have any effect.
      if (e.cancelable) e.preventDefault()
      const next = MAX_PULL * (1 - Math.exp(-raw / MAX_PULL))
      setPullDistance(next)
      pullDistanceRef.current = next
    }

    function onTouchEnd() {
      if (startY.current == null) return
      startY.current = null
      draggingRef.current = false
      const crossedThreshold = pullDistanceRef.current >= MAX_PULL * (1 - Math.exp(-THRESHOLD / MAX_PULL))
      setPullDistance(0)
      pullDistanceRef.current = 0
      if (crossedThreshold) runRefresh()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [runRefresh])

  return {
    pullDistance,
    isRefreshing,
    containerProps: {
      ref: containerRef,
      style: { overscrollBehaviorY: 'contain' as const },
    },
  }
}
