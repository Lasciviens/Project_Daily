import { useSyncExternalStore } from 'react'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'

// A screen under 500px tall — a phone held sideways (874×402), or a short
// window: its first screen has no room for a second row of filters either.
const SHORT = '(max-height: 499px)'

function subscribe(onChange: () => void): () => void {
  const q = window.matchMedia(SHORT)
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

/** Shop's filters fold behind one button on a phone and on a short screen, so the list starts on the first screen. */
export function useFoldedFilters(): boolean {
  const phone = useBreakpoint() === 'phone'
  const short = useSyncExternalStore(subscribe, () => window.matchMedia(SHORT).matches, () => false)
  return phone || short
}
