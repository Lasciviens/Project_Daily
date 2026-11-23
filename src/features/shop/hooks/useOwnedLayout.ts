import { useCallback, useState } from 'react'

/** How Owned shows its things: compact rows (the default), one line each, or big pictures. */
export type OwnedLayout = 'rows' | 'lines' | 'pictures'

/** Remembered on this device (a UI choice, like the folded categories) and cleared at sign-out (security/accountState.ts). */
export const OWNED_LAYOUT_KEY = 'lasci.shop.ownedView'
const LAYOUTS: readonly OwnedLayout[] = ['rows', 'lines', 'pictures']

/** The stored text as a layout; anything else (an old or hand-edited value) is the default. */
export function layoutOf(raw: string | null): OwnedLayout {
  return LAYOUTS.includes(raw as OwnedLayout) ? raw as OwnedLayout : 'rows'
}

function read(): OwnedLayout {
  try { return layoutOf(localStorage.getItem(OWNED_LAYOUT_KEY)) } catch { return 'rows' }
}

export function useOwnedLayout(): [OwnedLayout, (l: OwnedLayout) => void] {
  const [layout, setLayout] = useState<OwnedLayout>(read)
  const set = useCallback((next: OwnedLayout) => {
    setLayout(next)
    try { localStorage.setItem(OWNED_LAYOUT_KEY, next) } catch { /* storage unavailable: kept for this visit */ }
  }, [])
  return [layout, set]
}
