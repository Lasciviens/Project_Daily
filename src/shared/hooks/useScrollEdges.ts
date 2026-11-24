import { useEffect, useState, type RefObject } from 'react'
import { scrollEdges, type ScrollEdges } from '../ui/scrollPagerRules'

/**
 * Whether a horizontal scroller has more content beyond its left / right edge
 * (ScrollPager's buttons, an edge fade). Follows scrolling, resizing, and each
 * child: a picture that loads or a count that arrives widens what scrolls
 * without resizing the scroller itself; a new child is watched too.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setEdges(e => {
      const next = scrollEdges(el.scrollLeft, el.clientWidth, el.scrollWidth)
      return e.left === next.left && e.right === next.right ? e : next
    })
    const ro = new ResizeObserver(check)
    const watch = () => { ro.observe(el); for (const child of Array.from(el.children)) ro.observe(child) }
    watch()
    check()
    const added = new MutationObserver(() => { watch(); check() })
    added.observe(el, { childList: true })
    el.addEventListener('scroll', check, { passive: true })
    return () => { ro.disconnect(); added.disconnect(); el.removeEventListener('scroll', check) }
  }, [ref])
  return edges
}
