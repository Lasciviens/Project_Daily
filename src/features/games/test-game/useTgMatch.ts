import { useCallback, useSyncExternalStore } from 'react'

// The phone layout on a wide screen — a phone held sideways (852×393), or a
// narrow desktop window: the page's two header rows fold into one.
export const TG_WIDE_PHONE = '(min-width: 640px)'
// …and on a short one (a phone held sideways) they also slide away with the
// app header while the list scrolls down, or the covers get ~140px.
export const TG_SHORT_SCREEN = '(max-height: 499px)'

/** Whether a media query matches, kept live. */
export function useTgMatch(query: string): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const q = window.matchMedia(query)
    q.addEventListener('change', onChange)
    return () => q.removeEventListener('change', onChange)
  }, [query])
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false)
}
