import { useEffect, useState, type RefObject } from 'react'

/** Whether a horizontal scroller has more content beyond its left / right edge. */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): { left: boolean; right: boolean } {
  const [edges, setEdges] = useState({ left: false, right: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => {
      const left = el.scrollLeft > 2
      const right = el.scrollWidth - el.scrollLeft - el.clientWidth > 2
      setEdges(e => (e.left === left && e.right === right ? e : { left, right }))
    }
    // Observing reports once straight away; children can widen later (counts loading).
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    el.addEventListener('scroll', check, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', check) }
  }, [ref])
  return edges
}
