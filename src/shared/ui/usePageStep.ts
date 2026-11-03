import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import { boardStepForWidth, pageStepForWidth, type BoardLayouts, type PageStep } from './pageBoardRules'

// The measuring half of <PageBoard> (THEME.md §6.3): which step an element's
// OWN content width is at, and the step a board hands to its sections.

/** The step PageBoard provides to its sections (1 outside a board). */
export const PageStepContext = createContext<PageStep>(1)

/** The step of the nearest enclosing PageBoard (1 outside one). */
export function useBoardStep(): PageStep {
  return useContext(PageStepContext)
}

function rootFontPx(): number {
  if (typeof window === 'undefined') return 16
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

function stepFor(width: number, layouts: BoardLayouts<string> | undefined): PageStep {
  return layouts ? boardStepForWidth(width, layouts, rootFontPx()) : pageStepForWidth(width, rootFontPx())
}

/**
 * The step for an element's own content width. `step` is null until the
 * first measure, which runs before the first paint (layout effect), so the
 * right layout is the first one anybody sees. Given a board's `layouts`, the
 * step that board renders at (`boardStepForWidth`: an `early` step counts).
 */
export function usePageStep<T extends HTMLElement = HTMLDivElement>(layouts?: BoardLayouts<string>) {
  const ref = useRef<T>(null)
  const [step, setStep] = useState<PageStep | null>(null)
  const layoutsRef = useRef(layouts)
  const widthRef = useRef<number | null>(null)
  // A board whose layouts change (Work's Board | List) is stepped again at the width it has.
  useLayoutEffect(() => {
    layoutsRef.current = layouts
    if (widthRef.current != null) setStep(stepFor(widthRef.current, layouts))
  }, [layouts])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (width: number) => {
      widthRef.current = width
      setStep(stepFor(width, layoutsRef.current))
    }
    const read = () => {
      const cs = getComputedStyle(el)
      apply(el.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0'))
    }
    read()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read)
      return () => window.removeEventListener('resize', read)
    }
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w != null) apply(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, step }
}
