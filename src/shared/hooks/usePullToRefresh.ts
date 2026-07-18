import { useRef, useState, useCallback, useEffect } from 'react'

const MAX_PULL  = 88   // visual cap on how far the indicator travels
const THRESHOLD = 64   // release past this distance to trigger onRefresh
const SLOP      = 10   // finger travel before the gesture commits to an axis

// Distance (post-resistance-curve) the pull must reach to count as "release
// to refresh" — precomputed once so both the gesture handler and the
// indicator's "ready" state agree on the same number.
const READY_AT = MAX_PULL * (1 - Math.exp(-THRESHOLD / MAX_PULL))

// Native "pull down at the top of the page to refresh" gesture — hand-rolled
// (no maintained small library exists for this in 2026) via touch events +
// a resistance curve.
//
// WHY THE APP SHELL IS A FIXED-HEIGHT SCROLLER (the real-device fix): when
// the *document* was the scroll container, iOS decided who owns the gesture
// on the FIRST touchmove — if that first move wasn't preventDefault-ed
// (e.g. a pixel of upward jitter made us return early), Safari committed
// the root scroller's rubber-band, flipped `e.cancelable` to false for the
// rest of the gesture, and every later preventDefault was silently ignored.
// Result: the pull worked only when the very first move was cleanly
// downward — "çok iyi çalışmıyor" on a real phone. The app shell now locks
// the document (html/body/#root fixed height, layout root overflow-hidden)
// and <main> owns scrolling instead: at scrollTop 0 a downward pull has NO
// native scroll for iOS to commit to (overscroll-behavior contains
// chaining, and inner overflow containers don't rubber-band the way the
// root scroller does), so this hook keeps control even while the gesture
// is still ambiguous during the slop window.
//
// This hook is mounted ONCE at the app shell (src/app/layout.tsx). Most
// pages scroll in <main> itself (the container this hook is attached to),
// but the Personal group (Daily/Shop/Recipes, via PersonalLayout) scrolls
// inside its own nested overflow-y-auto container — isAtTop() walks up from
// the touch target looking for the nearest scrollable ancestor and checks
// its scrollTop; if none is found before reaching <main>, it checks
// <main>'s own scrollTop.
//
// Gesture state machine (prevents two real misfires):
//   idle → tracking (touch started while at top)
//        → pulling  (moved past SLOP, mostly vertical, downward) → refresh?
//   - Axis lock: a mostly-horizontal first move bails out, so swiping the
//     horizontal snap strips (Focus strip, poster rows) near the top of a
//     page never gets hijacked into a pull.
//   - Re-anchoring: pull distance is measured from where the gesture
//     COMMITTED, not from touchstart — no sudden 10px jump when it arms.
//
// Listeners are native addEventListener with `{ passive: false }`, NOT
// React's onTouchMove props — React attaches touch listeners as passive by
// default, which silently no-ops preventDefault().
export function usePullToRefresh(onRefresh: () => Promise<void>) {
  const [pullDistance, setPullDistance] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  // Refs mirroring state so the native listeners (attached once) always see
  // current values without needing to re-attach on every state change.
  const pullDistanceRef = useRef(0)
  const isRefreshingRef = useRef(false)
  const phaseRef = useRef<'idle' | 'tracking' | 'pulling'>('idle')
  const startX = useRef(0)
  const startY = useRef(0)
  const anchorY = useRef(0)

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

    function setPull(d: number) {
      setPullDistance(d)
      pullDistanceRef.current = d
    }

    function isScrollable(node: Element) {
      const style = getComputedStyle(node)
      return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight
    }

    function isAtTop(target: EventTarget | null): boolean {
      let node = target instanceof Element ? target : null
      while (node && node !== el) {
        if (isScrollable(node)) return node.scrollTop <= 2
        node = node.parentElement
      }
      // No nested scroll container between the touch target and <main> —
      // <main> itself is the page's scroller (see layout.tsx).
      return (el as HTMLElement).scrollTop <= 2
    }

    function onTouchStart(e: TouchEvent) {
      if (isRefreshingRef.current || e.touches.length !== 1) {
        phaseRef.current = 'idle'
        return
      }
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
      phaseRef.current = isAtTop(e.target) ? 'tracking' : 'idle'
    }

    function onTouchMove(e: TouchEvent) {
      if (phaseRef.current === 'idle') return
      const x = e.touches[0].clientX
      const y = e.touches[0].clientY

      if (phaseRef.current === 'tracking') {
        const dx = x - startX.current
        const dy = y - startY.current
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return // still ambiguous
        if (Math.abs(dx) > Math.abs(dy) || dy <= 0 || !isAtTop(e.target)) {
          phaseRef.current = 'idle' // horizontal swipe / scroll-up — not ours
          return
        }
        phaseRef.current = 'pulling'
        anchorY.current = y
      }

      // Committed pull — take the gesture over from the browser entirely.
      if (e.cancelable) e.preventDefault()
      const raw = y - anchorY.current
      setPull(raw <= 0 ? 0 : MAX_PULL * (1 - Math.exp(-raw / MAX_PULL)))
    }

    function onTouchEnd() {
      const crossed = phaseRef.current === 'pulling' && pullDistanceRef.current >= READY_AT
      phaseRef.current = 'idle'
      setPull(0)
      if (crossed) runRefresh()
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
    // Past the release threshold — the indicator flips to its "release to
    // refresh" look so the user knows letting go will actually do something.
    isReady: pullDistance >= READY_AT,
    containerProps: {
      ref: containerRef,
      style: { overscrollBehaviorY: 'contain' as const },
    },
  }
}
