import { useState, useEffect, useCallback, useRef } from 'react'

// The on-screen keyboard vs a fixed bottom sheet — the bug this exists for.
//
// The AI panel is `fixed bottom-0 h-[88vh]` on a phone. When iOS raises the
// keyboard it does NOT change the layout viewport: `vh`, `bottom-0` and
// `100%` all keep measuring the FULL screen, so the panel stays its original
// size and its input row ends up underneath the keyboard — you type and cannot
// see what you typed. (Android Chrome resizes the layout viewport, so it only
// breaks on iOS, which is the primary device here.)
//
// The only thing that reports the truth is `window.visualViewport`: its
// `height` shrinks by the keyboard and `offsetTop` moves when the page is
// scrolled by focus. `inset` below is how many pixels at the bottom of the
// window are covered — the panel lifts by exactly that much.
export function useKeyboardInset(active: boolean) {
  const [inset, setInset] = useState(0)
  const [visibleHeight, setVisibleHeight] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    // Nothing to subscribe to: report no keyboard by deriving it at the call
    // site instead of setting state from inside the effect body.
    if (!vv || !active) return
    const update = () => {
      const covered = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      // Browser chrome (URL bar) also moves the visual viewport by a few dozen
      // px; only a real keyboard is this big, so a threshold keeps the panel
      // from twitching during ordinary scrolling.
      setInset(covered > 120 ? Math.round(covered) : 0)
      setVisibleHeight(Math.round(vv.height))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [active])

  // While inactive the subscription is torn down and `inset` keeps its last
  // value, so gate it here — the panel must never be offset when it is closed.
  return { inset: active ? inset : 0, visibleHeight }
}

// Auto-scrolling a chat is only welcome when the user is already at the
// bottom. Blindly scrolling on every message yanks the view away from someone
// who scrolled up to re-read an earlier answer, so track "is the user pinned to
// the bottom" and expose a manual jump for when they are not.
export function useStickToBottom(deps: unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior })
  }, [])

  useEffect(() => {
    if (atBottom) scrollToBottom('smooth')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  return { scrollRef, atBottom, onScroll, scrollToBottom }
}
