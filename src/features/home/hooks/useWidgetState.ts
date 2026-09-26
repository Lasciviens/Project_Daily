import { useCallback, useSyncExternalStore } from 'react'

// ─────────────────────────────────────────────────────────────────────────────
//  Per-widget collapse state for Home, persisted in localStorage
//  (`widget_state_<id>`, the same key the old hook used, so saved choices
//  survive). One shared store: two components reading the same id always
//  agree, and a collapsed widget's queries stay disabled everywhere.
// ─────────────────────────────────────────────────────────────────────────────

interface Options {
  /** Default when nothing is saved yet. */
  collapsed?: boolean
  /** First visit on a phone-width screen starts collapsed (not saved until toggled). */
  mobileCollapsed?: boolean
}

export interface WidgetState {
  collapsed: boolean
  toggle: () => void
  setCollapsed: (collapsed: boolean) => void
}

const storageKey = (id: string) => `widget_state_${id}`
const cache = new Map<string, boolean>()
const listeners = new Set<() => void>()

function readSaved(id: string): boolean | null {
  try {
    const raw = localStorage.getItem(storageKey(id))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { collapsed?: unknown }
    return typeof parsed.collapsed === 'boolean' ? parsed.collapsed : null
  } catch {
    return null
  }
}

function initial(id: string, { collapsed = false, mobileCollapsed = false }: Options): boolean {
  const saved = readSaved(id)
  if (saved != null) return saved
  if (mobileCollapsed && typeof window !== 'undefined' && window.innerWidth < 640) return true
  return collapsed
}

function write(id: string, collapsed: boolean) {
  cache.set(id, collapsed)
  try { localStorage.setItem(storageKey(id), JSON.stringify({ collapsed })) } catch { /* private mode / quota */ }
  listeners.forEach(l => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useWidgetState(id: string, options: Options = {}): WidgetState {
  const collapsed = useSyncExternalStore(
    subscribe,
    () => {
      if (!cache.has(id)) cache.set(id, initial(id, options))
      return cache.get(id)!
    },
    () => options.collapsed ?? false,
  )
  const setCollapsed = useCallback((next: boolean) => write(id, next), [id])
  const toggle = useCallback(() => write(id, !(cache.get(id) ?? false)), [id])
  return { collapsed, toggle, setCollapsed }
}
