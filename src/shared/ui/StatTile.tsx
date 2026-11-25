import type { ReactNode } from 'react'
import { cx } from './cx'
import type { Tone } from './Tone'
import { Truncate } from './Truncate'

interface StatTileProps {
  label: ReactNode
  value: ReactNode
  /** Unit or qualifier after the number ("kcal", "/ 8"). */
  unit?: ReactNode
  hint?: ReactNode
  /** The change against something (the weekly report's "+55 % vs last week"), on its own line under the number. */
  change?: ReactNode
  /** A recessed tile inside a card (surface-2, no border or shadow, a smaller number): never a card in a card. */
  inset?: boolean
  icon?: ReactNode
  tone?: Tone
  onClick?: () => void
  className?: string
}

/** A KPI: eyebrow label, big tabular number, one line of context. */
export function StatTile({ label, value, unit, hint, change, inset = false, icon, tone, onClick, className }: StatTileProps) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 section-label">
        {icon != null && <span aria-hidden className="[&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        {label}
      </span>
      <span className={cx('flex items-baseline gap-1', inset ? 'mt-1' : 'mt-1.5')}>
        <span data-tone={tone} className={cx(inset ? 'text-head' : 'text-kpi', 'font-bold tabular-nums tracking-tight', tone ? 'tone-text' : 'text-fg')}>{value}</span>
        {unit != null && <span className="text-meta font-medium text-fg-muted">{unit}</span>}
      </span>
      {change != null && <span className="mt-0.5 min-w-0">{change}</span>}
      {hint != null && <Truncate className="mt-0.5 text-meta text-fg-muted">{hint}</Truncate>}
    </>
  )
  const base = cx('flex min-w-0 flex-col', inset ? 'p-3' : 'p-4', className)
  return onClick
    ? <button type="button" onClick={onClick} className={cx(inset ? 'press-feedback rounded-row bg-surface-2 text-left' : 'card-interactive text-left', base)}>{body}</button>
    : <div className={cx(inset ? 'rounded-row bg-surface-2' : 'card', base)}>{body}</div>
}
