import { useSyncExternalStore } from 'react'
import { useThemeStore } from '../../app/store'

// The JS side of the motion setting (THEME.md §7). CSS motion is gated by
// html[data-motion='extra'] + a prefers-reduced-motion override in index.css;
// motion that runs in JavaScript (count-ups, ring sweeps) asks these hooks.

const REDUCE = '(prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void) {
  const q = window.matchMedia(REDUCE)
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

/** The OS "reduce motion" setting, live. Server/prerender: assume reduced. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(REDUCE).matches, () => true)
}

/** Whether the extra ("More") animations should run: the setting is on AND the OS doesn't ask for less. */
export function useMotion(): boolean {
  const extra = useThemeStore(s => s.motion) === 'extra'
  const reduced = useReducedMotion()
  return extra && !reduced
}
