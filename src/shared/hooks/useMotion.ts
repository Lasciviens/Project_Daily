import { useSyncExternalStore } from 'react'

// The JS side of the motion set (THEME.md §7). CSS motion is switched off by
// a prefers-reduced-motion override in index.css; motion that runs in
// JavaScript (count-ups, ring sweeps) asks these hooks.

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

/** Whether the motion set should run: always, unless the OS asks for less. */
export function useMotion(): boolean {
  return !useReducedMotion()
}
