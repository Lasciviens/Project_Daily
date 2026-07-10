import { useRef, useState, useCallback } from 'react'

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
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const startY = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY <= 0 && !isRefreshing) {
      startY.current = e.touches[0].clientY
    }
  }, [isRefreshing])

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current == null || window.scrollY > 0) return
    const raw = e.touches[0].clientY - startY.current
    if (raw <= 0) { setPullDistance(0); return }
    // Diminishing-returns resistance curve — feels native, not a hard clamp.
    setPullDistance(MAX_PULL * (1 - Math.exp(-raw / MAX_PULL)))
  }, [])

  const onTouchEnd = useCallback(async () => {
    if (startY.current == null) return
    startY.current = null
    const crossedThreshold = pullDistance >= MAX_PULL * (1 - Math.exp(-THRESHOLD / MAX_PULL))
    if (crossedThreshold) {
      setIsRefreshing(true)
      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
      }
    }
    setPullDistance(0)
  }, [pullDistance, onRefresh])

  return {
    pullDistance,
    isRefreshing,
    containerProps: {
      ref: containerRef,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      style: { overscrollBehaviorY: 'contain' as const },
    },
  }
}
