import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { whenSettled } from '../utils/whenIdle'

interface Preloadable { preload: () => Promise<void> }

/** Loads each one's code in turn: one download and one module at a time. */
export async function preloadInTurn(parts: readonly Preloadable[]): Promise<void> {
  for (const part of parts) await part.preload()
}

// One wait per list, however many components ask for it (every task row asks
// for its sheet's picker): the list → how many are mounted, and the cancel.
const waiting = new Map<readonly Preloadable[], { users: number; cancel: () => void }>()

/**
 * A page's on-demand parts (its other tabs, `lazyPart`) load once the page is
 * drawn with its data, at the next quiet moment (whenSettled), so opening one
 * is instant while the first paint carries only the open tab. `parts` is a
 * module-level constant.
 */
export function useIdlePreload(parts: readonly Preloadable[]): void {
  const qc = useQueryClient()
  useEffect(() => {
    let wait = waiting.get(parts)
    if (!wait) {
      const entry = { users: 0, cancel: () => {} }
      entry.cancel = whenSettled(qc, () => { waiting.delete(parts); void preloadInTurn(parts) })
      waiting.set(parts, entry)
      wait = entry
    }
    const mine = wait
    mine.users++
    return () => {
      mine.users--
      if (mine.users === 0 && waiting.get(parts) === mine) { mine.cancel(); waiting.delete(parts) }
    }
  }, [qc, parts])
}
