import { useEffect, useRef, useState, type RefObject } from 'react'
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

/**
 * Asks for a fresh measurement without reading layout now: a new observation
 * reports as soon as the box is laid out — at once when it is on screen, and
 * only once it scrolls into view inside a `content-visibility: auto` section.
 * Reading scrollWidth there instead forces a layout of each skipped section:
 * ~1ms per element, seconds for the Games bookcase's ~3,300 labels whenever a
 * web font arrived.
 */
function remeasure(el: Element, w: Watch) {
  if (!observer) { measure(el, w); return }
  observer.unobserve(el)
  observer.observe(el)
}

function measureAll() {
  for (const [el, w] of watched) remeasure(el, w)
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
 * The element behind `ref` while its text is really cut by its `truncate` /
 * `line-clamp-N`, else null. Re-checks when the box resizes (the observer's
 * first report measures it on mount), when fonts load and when `textKey`
 * changes (new text in a box that kept its size). `nodeKey` changes when the
 * ref moves to a new element (another tag). Text that fits costs one render.
 */
export function useTruncatedElement(ref: RefObject<HTMLElement | null>, lines: number, textKey?: string, nodeKey?: unknown): HTMLElement | null {
  const [cutEl, setCutEl] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const w: Watch = { lines, set: cut => setCutEl(cut ? el : null) }
    watched.set(el, w)
    const obs = getObserver()
    if (obs) {
      obs.observe(el)
      return () => { watched.delete(el); obs.unobserve(el) }
    }
    // No ResizeObserver: measure once after layout.
    const id = requestAnimationFrame(() => measure(el, w))
    return () => { watched.delete(el); cancelAnimationFrame(id) }
  }, [ref, lines, nodeKey])

  // New text in the same box. Skipped on mount: the observer already measures.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return }
    const el = ref.current
    const w = el ? watched.get(el) : undefined
    if (!el || !w) return
    if (observer) { remeasure(el, w); return }
    const id = requestAnimationFrame(() => measure(el, w))
    return () => cancelAnimationFrame(id)
  }, [ref, textKey])

  return cutEl
}

/** Whether the text behind `ref` is really cut (see useTruncatedElement). */
export function useIsTruncated(ref: RefObject<HTMLElement | null>, lines: number, textKey?: string, nodeKey?: unknown): boolean {
  return useTruncatedElement(ref, lines, textKey, nodeKey) != null
}
