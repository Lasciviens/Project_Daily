import { useEffect, useState, type RefObject } from 'react'

/**
 * True once the element has come within `rootMargin` of the viewport, and
 * from then on — so a fetch keyed to it starts when the card scrolls into
 * view and never stops again. Without IntersectionObserver it is true at once.
 */
export function useSeenOnce(ref: RefObject<Element | null>, rootMargin = '200px'): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (seen || !el) return
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setSeen(true)
        io.disconnect()
      }
    }, { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, seen, rootMargin])
  return seen
}
