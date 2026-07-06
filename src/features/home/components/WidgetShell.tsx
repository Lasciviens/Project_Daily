import type { ReactNode } from 'react'
import type { WidgetStateResult } from '../hooks/useWidgetState'

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
  // Each widget's onManualSync owns calling ws.markSynced() itself (some gate
  // it on success, e.g. CurrencyWidget) — calling it here too always marked
  // "synced" even on a failed fetch and double-fired it for widgets that also
  // call it internally.

  return (
    <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
      {/* ── Header — wraps to a second row rather than clipping content/buttons
           when the widget sits in a narrow column (e.g. the 280px sidebar). ── */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-ink-100 min-h-[44px]">
        {/* Collapse toggle — oversized tap target on mobile, compact on desktop */}
        {/* 44px tap target on mobile, compact 16px on desktop */}
        <button
          onClick={ws.toggle}
          className="text-ink-400 hover:text-ink-700 transition-colors duration-150 flex-shrink-0 min-w-[44px] min-h-[44px] -ml-3 flex items-center justify-center lg:min-w-0 lg:min-h-0 lg:ml-0 lg:w-4 lg:flex-none"
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

            {/* Pause / Resume auto-sync — min 44px tap target on mobile */}
            <button
              onClick={ws.toggleSync}
              title={ws.syncActive ? 'Pause auto-sync' : 'Resume auto-sync'}
              className={`text-xs rounded transition-colors duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center lg:min-w-0 lg:min-h-0 lg:px-1 ${
                ws.syncActive
                  ? 'text-ink-400 hover:text-ink-700'
                  : 'text-accent-500 hover:text-accent-700'
              }`}
            >
              {ws.syncActive ? '⏸' : '▶'}
            </button>

            {/* Manual sync — min 44px tap target on mobile */}
            {onManualSync && (
              <button
                onClick={onManualSync}
                title="Sync now"
                className="text-xs text-ink-400 hover:text-accent-600 transition-colors duration-150 min-w-[44px] min-h-[44px] flex items-center justify-center lg:min-w-0 lg:min-h-0"
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
