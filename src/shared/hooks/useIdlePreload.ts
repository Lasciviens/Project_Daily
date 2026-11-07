import { useEffect } from 'react'
import { whenIdle } from '../utils/whenIdle'

interface Preloadable { preload: () => Promise<void> }

/** Loads each one's code in turn: one download and one module at a time. */
export async function preloadInTurn(parts: readonly Preloadable[]): Promise<void> {
  for (const part of parts) await part.preload()
}

/**
 * A page's on-demand parts (its other tabs, `lazyPart`) load at the first quiet
 * moment after the page shows, so opening one is instant while the first
 * paint carries only the open tab. `parts` is a module-level constant.
 */
export function useIdlePreload(parts: readonly Preloadable[]): void {
  useEffect(() => whenIdle(() => { void preloadInTurn(parts) }), [parts])
}
