import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'
import { pageStepForWidth, type PageStep } from './pageBoardRules'

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

/**
 * The step for an element's own content width. `step` is null until the
 * first measure, which runs before the first paint (layout effect), so the
 * right layout is the first one anybody sees.
 */
export function usePageStep<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [step, setStep] = useState<PageStep | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const apply = (width: number) => setStep(pageStepForWidth(width, rootFontPx()))
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
