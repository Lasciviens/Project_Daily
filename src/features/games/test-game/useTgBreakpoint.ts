import { useSyncExternalStore } from 'react'

// Which of the page's three layouts to render. JS rather than CSS-only
// because the three trees are genuinely different components (a bookcase vs a
// two-column phone grid) — rendering all of them and hiding two would mount
// every cover three times.
//
//   mobile  < 768   phone header, 2-col grid, bottom tabs, full-screen detail
//   tablet  768–1279 sidebar + content, detail slides in from the right
//   desktop ≥ 1280  sidebar + content + permanent detail panel (the design)

export type TgBreakpoint = 'mobile' | 'tablet' | 'desktop'

const TABLET = '(min-width: 768px)'
const DESKTOP = '(min-width: 1280px)'

function read(): TgBreakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia(DESKTOP).matches) return 'desktop'
  if (window.matchMedia(TABLET).matches) return 'tablet'
  return 'mobile'
}

function subscribe(onChange: () => void): () => void {
  const queries = [window.matchMedia(TABLET), window.matchMedia(DESKTOP)]
  queries.forEach(q => q.addEventListener('change', onChange))
  return () => queries.forEach(q => q.removeEventListener('change', onChange))
}

export function useTgBreakpoint(): TgBreakpoint {
  return useSyncExternalStore(subscribe, read, () => 'desktop')
}
