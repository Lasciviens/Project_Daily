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
    bordered ? 'rounded-2xl border border-dashed border-ink-200 bg-cream-50' : ''
  } ${className}`

  return (
    <div className={base}>
      {icon != null && <span className="text-3xl text-ink-400">{icon}</span>}
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description != null && (
        <p className="max-w-sm text-xs text-ink-500">{description}</p>
      )}
      {action != null && <div className="mt-2">{action}</div>}
    </div>
  )
}
