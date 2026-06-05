import type { ReactNode } from 'react'
import { SYNC_INTERVALS, type WidgetStateResult } from '../hooks/useWidgetState'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WidgetShellProps {
  title:        string
  ws:           WidgetStateResult   // from useWidgetState()
  onManualSync?: () => void         // called when user clicks the ↻ button
  headerRight?: ReactNode           // extra content next to title (e.g. mode tabs)
  children:     ReactNode
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Wraps every home-page widget with a consistent header that provides:
 *   • collapse/expand toggle
 *   • last-sync timestamp
 *   • pause/resume auto-sync
 *   • sync interval selector (1m / 10m / 30m / 1h)
 *   • manual sync button
 *
 * The parent widget controls the actual TanStack Query enabled/refetchInterval
 * based on ws.collapsed and ws.syncActive — this shell only renders the controls.
 */
export function WidgetShell({ title, ws, onManualSync, headerRight, children }: WidgetShellProps) {
  function handleManualSync() {
    if (onManualSync) {
      onManualSync()
      ws.markSynced()
    }
  }

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
      {/* ── Header ── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-ink-100 min-h-[40px]">
        {/* Collapse toggle */}
        <button
          onClick={ws.toggle}
          className="text-ink-400 hover:text-ink-700 transition-colors duration-150 w-4 text-center flex-shrink-0"
          title={ws.collapsed ? 'Expand' : 'Collapse'}
        >
          {ws.collapsed ? '▶' : '▼'}
        </button>

        {/* Title */}
        <h3 className="text-xs font-semibold text-ink-500 uppercase tracking-wide flex-1 truncate">
          {title}
        </h3>

        {/* Extra header content (e.g. tab switcher for currency modes) */}
        {headerRight && !ws.collapsed && (
          <div className="flex items-center">{headerRight}</div>
        )}

        {/* Sync controls — only visible when expanded */}
        {!ws.collapsed && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Last sync timestamp */}
            <span className="text-[10px] text-ink-300 hidden sm:block">
              {ws.lastSyncLabel}
            </span>

            {/* Pause / Resume auto-sync */}
            <button
              onClick={ws.toggleSync}
              title={ws.syncActive ? 'Pause auto-sync' : 'Resume auto-sync'}
              className={`text-xs px-1 rounded transition-colors duration-150 ${
                ws.syncActive
                  ? 'text-ink-400 hover:text-ink-700'
                  : 'text-amber-500 hover:text-amber-700'
              }`}
            >
              {ws.syncActive ? '⏸' : '▶'}
            </button>

            {/* Interval selector */}
            <select
              value={ws.intervalMs}
              onChange={e => ws.setInterval(Number(e.target.value))}
              className="text-[10px] text-ink-400 bg-transparent border border-ink-200 rounded px-1 py-0.5 cursor-pointer focus:outline-none hover:border-ink-300"
            >
              {SYNC_INTERVALS.map(i => (
                <option key={i.ms} value={i.ms}>{i.label}</option>
              ))}
            </select>

            {/* Manual sync */}
            {onManualSync && (
              <button
                onClick={handleManualSync}
                title="Sync now"
                className="text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150"
              >
                ↻
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Body — hidden when collapsed ── */}
      {!ws.collapsed && (
        <div className="p-4">{children}</div>
      )}
    </div>
  )
}
