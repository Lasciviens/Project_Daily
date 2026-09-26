import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  /** Wrap the state in a dashed-border placeholder container. */
  bordered?: boolean
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  bordered = false,
  className = '',
}: EmptyStateProps) {
  const base = `flex flex-col items-center justify-center gap-2 py-12 px-4 text-center ${
    bordered ? 'rounded-card border border-dashed border-line bg-surface' : ''
  } ${className}`

  return (
    <div className={base}>
      {icon != null && <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-xl text-fg-faint [&_svg]:h-5 [&_svg]:w-5">{icon}</span>}
      <p className="text-ui font-semibold text-fg">{title}</p>
      {description != null && (
        <p className="max-w-sm text-body text-fg-muted">{description}</p>
      )}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  )
}
