import { useEffect, useState } from 'react'
import { isTextCut } from '../ui/truncateRules'

// ONE ResizeObserver for the whole page, not one per element: the Games grid
// alone renders ~1,500 titles. Each watched element registers the setter that
// receives its "is the text cut?" answer.

interface Watch { lines: number; set: (cut: boolean) => void }

const watched = new Map<Element, Watch>()
let observer: ResizeObserver | null = null

function measure(el: Element, w: Watch) {
  const h = el as HTMLElement
  w.set(isTextCut({ scrollWidth: h.scrollWidth, clientWidth: h.clientWidth, scrollHeight: h.scrollHeight, clientHeight: h.clientHeight }, w.lines))
}

function measureAll() {
  for (const [el, w] of watched) measure(el, w)
}

function getObserver(): ResizeObserver | null {
  if (observer || typeof ResizeObserver === 'undefined') return observer
  observer = new ResizeObserver(entries => {
    for (const e of entries) {
      const w = watched.get(e.target)
      if (w) measure(e.target, w)
    }
  })
  // A web font arriving changes text width without resizing a width-capped
  // box, which a ResizeObserver can't see.
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined
  if (fonts) {
    void fonts.ready.then(measureAll)
    fonts.addEventListener?.('loadingdone', measureAll)
  }
  return observer
}

/**
 * Whether `el`'s text is really cut by its `truncate` / `line-clamp-N`.
 * Re-checks when the box resizes, when fonts load and when `textKey` changes
 * (new text in a box that kept its size).
 */
export function useIsTruncated(el: HTMLElement | null, lines: number, textKey?: string): boolean {
  const [cut, setCut] = useState(false)

  useEffect(() => {
    if (!el) return
    const obs = getObserver()
    watched.set(el, { lines, set: setCut })
    obs?.observe(el)
    return () => {
      watched.delete(el)
      obs?.unobserve(el)
    }
  }, [el, lines])

  useEffect(() => {
    if (!el) return
    const id = requestAnimationFrame(() => {
      const w = watched.get(el)
      if (w) measure(el, w)
    })
    return () => cancelAnimationFrame(id)
  }, [el, lines, textKey])

  return cut
}
