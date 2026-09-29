import { useLayoutEffect, useState } from 'react'

/**
 * An element's own width in rem (its clientWidth ÷ the root font size), kept
 * current with a ResizeObserver. Null until the first measure, which runs
 * before the first paint (layout effect). For layouts that follow the space a
 * component actually gets — the sidebar, a drawer or a board column all
 * change it — rather than the viewport. Put the ref on an element without
 * padding (clientWidth includes it).
 *
 * `ref` is a callback ref, so an element that unmounts and comes back (a list
 * swapped for a detail view and back) is measured again.
 */
export function useElementWidthRem<T extends HTMLElement = HTMLDivElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!el) return
    const read = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      setWidth(el.clientWidth / rem)
    }
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return { ref: setEl, width }
}
