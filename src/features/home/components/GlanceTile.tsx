import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Skeleton, cx } from '../../../shared/ui'

interface GlanceTileProps {
  label: string
  icon: ReactNode
  value: ReactNode
  hint?: ReactNode
  /** In-app route, or… */
  to?: string
  /** …an action (a popup). */
  onClick?: () => void
  loading?: boolean
  className?: string
}

/** A phone glance tile (THEME.md §6.3): label, one big value, one line of context; opens its detail. */
export function GlanceTile({ label, icon, value, hint, to, onClick, loading, className }: GlanceTileProps) {
  const body = (
    <>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="text-accent-600 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        <span className="section-label flex-1 truncate">{label}</span>
        <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-faint" />
      </span>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-7 w-16" />
          <Skeleton className="mt-1.5 h-3 w-24" />
        </>
      ) : (
        <>
          <span className="mt-1.5 block truncate text-title font-bold tabular-nums text-fg">{value}</span>
          {hint != null && <span className="mt-0.5 block truncate text-meta text-fg-muted">{hint}</span>}
        </>
      )}
    </>
  )
  const cls = cx('card-interactive flex min-h-[96px] min-w-0 flex-col p-3.5 text-left', className)
  return to
    ? <Link to={to} className={cls}>{body}</Link>
    : <button type="button" onClick={onClick} className={cls}>{body}</button>
}
