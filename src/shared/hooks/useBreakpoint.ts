import { useSyncExternalStore } from 'react'

// Which shell to render (THEME.md §6.1). JS rather than CSS-only because the
// trees genuinely differ (sidebar + top bar vs phone header + tab bar) —
// mounting both and hiding one would duplicate view-transition names and
// every always-on hook inside them.
//
//   phone    < 768, or a touch screen shorter than 500px (a phone turned
//            sideways is "tablet" wide but has no room for a sidebar and a
//            top bar under a notch)
//   tablet   768–1279  icon-rail sidebar + top bar
//   desktop  ≥ 1280    full sidebar + top bar
export type Breakpoint = 'phone' | 'tablet' | 'desktop'

const TABLET = '(min-width: 768px)'
const DESKTOP = '(min-width: 1280px)'
const LANDSCAPE_PHONE = '(pointer: coarse) and (max-height: 499px)'

function read(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.matchMedia(LANDSCAPE_PHONE).matches) return 'phone'
  if (window.matchMedia(DESKTOP).matches) return 'desktop'
  if (window.matchMedia(TABLET).matches) return 'tablet'
  return 'phone'
}

function subscribe(onChange: () => void): () => void {
  const queries = [TABLET, DESKTOP, LANDSCAPE_PHONE].map(q => window.matchMedia(q))
  queries.forEach(q => q.addEventListener('change', onChange))
  return () => queries.forEach(q => q.removeEventListener('change', onChange))
}

export function useBreakpoint(): Breakpoint {
  return useSyncExternalStore(subscribe, read, () => 'desktop')
}
