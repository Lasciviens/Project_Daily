import { useState, useCallback } from 'react'
import { formatDistanceToNow } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WidgetSyncInterval {
  label: string
  ms: number
}

// Available sync intervals shown in the widget header dropdown
export const SYNC_INTERVALS: WidgetSyncInterval[] = [
  { label: '1m',  ms: 1 * 60_000 },
  { label: '10m', ms: 10 * 60_000 },
  { label: '30m', ms: 30 * 60_000 },
  { label: '1h',  ms: 60 * 60_000 },
]

interface PersistedState {
  collapsed:   boolean
  syncActive:  boolean
  intervalMs:  number
  lastSyncedAt: number | null
}

export interface WidgetStateResult extends PersistedState {
  lastSyncLabel: string
  toggle:      () => void
  toggleSync:  () => void
  setInterval: (ms: number) => void
  markSynced:  () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function storageKey(widgetId: string) {
  return `widget_state_${widgetId}`
}

function loadPersistedState(widgetId: string, defaults: Partial<PersistedState>): PersistedState {
  try {
    const raw = localStorage.getItem(storageKey(widgetId))
    if (raw) return { ...buildDefaults(defaults), ...JSON.parse(raw) }
  } catch { /* corrupt localStorage — fall through to defaults */ }
  return buildDefaults(defaults)
}

function buildDefaults(overrides: Partial<PersistedState>): PersistedState {
  return {
    collapsed:    false,
    syncActive:   true,
    intervalMs:   10 * 60_000,
    lastSyncedAt: null,
    ...overrides,
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages per-widget UI state: collapsed, sync interval, sync paused.
 * State is persisted to localStorage so it survives page reloads.
 *
 * Usage:
 *   const ws = useWidgetState('weather', { collapsed: false, intervalMs: 10 * 60_000 })
 *   // Pass ws.syncEnabled to TanStack Query's `enabled` + `refetchInterval`
 */
export function useWidgetState(
  widgetId: string,
  defaults?: Partial<PersistedState>
): WidgetStateResult {
  const [state, setState] = useState<PersistedState>(() =>
    loadPersistedState(widgetId, defaults ?? {})
  )

  // Persist a partial update and return next state
  const patch = useCallback((update: Partial<PersistedState>) => {
    setState(prev => {
      const next = { ...prev, ...update }
      try { localStorage.setItem(storageKey(widgetId), JSON.stringify(next)) } catch { /* quota exceeded — ignore */ }
      return next
    })
  }, [widgetId])

  const lastSyncLabel = state.lastSyncedAt
    ? formatDistanceToNow(new Date(state.lastSyncedAt), { addSuffix: true })
    : 'never'

  return {
    ...state,
    lastSyncLabel,
    toggle:      () => patch({ collapsed: !state.collapsed }),
    toggleSync:  () => patch({ syncActive: !state.syncActive }),
    setInterval: (ms: number) => patch({ intervalMs: ms }),
    markSynced:  () => patch({ lastSyncedAt: Date.now() }),
  }
}
