import type { ReactNode } from 'react'
import { cx } from './cx'
import type { Tone } from './Tone'

interface StatTileProps {
  label: ReactNode
  value: ReactNode
  /** Unit or qualifier after the number ("kcal", "/ 8"). */
  unit?: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: Tone
  onClick?: () => void
  className?: string
}

/** A KPI: eyebrow label, big tabular number, one line of context. */
export function StatTile({ label, value, unit, hint, icon, tone, onClick, className }: StatTileProps) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 section-label">
        {icon != null && <span aria-hidden className="[&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        {label}
      </span>
      <span className="mt-1.5 flex items-baseline gap-1">
        <span data-tone={tone} className={cx('text-kpi font-bold tabular-nums tracking-tight', tone ? 'tone-text' : 'text-fg')}>{value}</span>
        {unit != null && <span className="text-meta font-medium text-fg-muted">{unit}</span>}
      </span>
      {hint != null && <span className="mt-0.5 block truncate text-meta text-fg-muted">{hint}</span>}
    </>
  )
  const base = cx('flex min-w-0 flex-col p-4', className)
  return onClick
    ? <button type="button" onClick={onClick} className={cx('card-interactive text-left', base)}>{body}</button>
    : <div className={cx('card', base)}>{body}</div>
}
