import { useCallback, useState } from 'react'

// Which category sections are folded, per view, remembered on this device
// (localStorage; a private window or blocked storage simply starts open).
const KEY = (view: string) => `lasci.shop.collapsed.${view}`

function read(view: string): Set<string> {
  try {
    const raw = localStorage.getItem(KEY(view))
    const list = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
  } catch { return new Set() }
}

export function useCollapsedGroups(view: 'wishlist' | 'owned') {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => read(view))
  const save = useCallback((next: Set<string>) => {
    setCollapsed(next)
    try { localStorage.setItem(KEY(view), JSON.stringify([...next])) } catch { /* storage unavailable: kept for this visit */ }
  }, [view])
  const toggle = useCallback((key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key); else next.add(key)
    save(next)
  }, [collapsed, save])
  const setAll = useCallback((keys: string[], fold: boolean) => save(fold ? new Set(keys) : new Set()), [save])
  return { collapsed, toggle, setAll }
}
