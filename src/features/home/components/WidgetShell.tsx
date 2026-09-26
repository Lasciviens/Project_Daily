import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { Card, IconButton, cx } from '../../../shared/ui'
import type { WidgetState } from '../hooks/useWidgetState'

interface WidgetShellProps {
  title: string
  icon?: ReactNode
  ws: WidgetState
  /** Extra header controls (mode tabs); shown only while expanded. */
  headerRight?: ReactNode
  /** Explicit refresh; the icon spins while `refreshing`. */
  onRefresh?: () => void
  refreshing?: boolean
  /** Link-out in the header ("Open" → the feature's own page). */
  to?: string
  children: ReactNode
  className?: string
}

/**
 * The Home widget frame: a Card whose header collapses the body. The widget
 * itself disables its queries while `ws.collapsed`, so a closed card costs
 * nothing. Pull-to-refresh covers routine refreshing; `onRefresh` is for the
 * few widgets where a manual refresh matters (live departures, currency).
 */
export function WidgetShell({ title, icon, ws, headerRight, onRefresh, refreshing, to, children, className }: WidgetShellProps) {
  const bodyId = `widget-${title.toLowerCase().replace(/\s+/g, '-')}`
  return (
    <Card padded={false} className={cx('min-w-0', className)}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1 pl-1 pr-2">
        <button
          type="button"
          onClick={ws.toggle}
          aria-expanded={!ws.collapsed}
          aria-controls={bodyId}
          className="flex min-h-[44px] min-w-0 flex-1 items-center gap-2 rounded-control px-2 text-left"
        >
          {ws.collapsed
            ? <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />
            : <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-fg-faint" />}
          {icon != null && (
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
          )}
          <h2 className="truncate text-lead font-semibold text-fg">{title}</h2>
        </button>
        {!ws.collapsed && headerRight != null && <div className="flex items-center">{headerRight}</div>}
        {!ws.collapsed && onRefresh && (
          <IconButton label={`Refresh ${title.toLowerCase()}`} onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cx(refreshing && 'animate-spin motion-reduce:animate-none')} />
          </IconButton>
        )}
        {to && (
          <Link to={to} className="inline-flex min-h-[44px] items-center gap-0.5 rounded-control px-2 text-meta font-semibold text-accent-600">
            Open <ChevronRight aria-hidden className="h-3.5 w-3.5" />
          </Link>
        )}
      </header>
      {!ws.collapsed && <div id={bodyId} className="px-4 pb-4 sm:px-5 sm:pb-5">{children}</div>}
    </Card>
  )
}
