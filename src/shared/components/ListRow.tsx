import type { ReactNode } from 'react'

interface ListRowProps {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  className?: string
}

export function ListRow({
  leading,
  title,
  subtitle,
  meta,
  trailing,
  onClick,
  className = '',
}: ListRowProps) {
  const base = `row ${onClick ? 'row-interactive' : ''} ${className}`

  const content = (
    <>
      {leading != null && <span className="shrink-0">{leading}</span>}
      <span className="flex-1 min-w-0">
        <span className="block truncate text-body font-medium text-fg">{title}</span>
        {subtitle != null && (
          <span className="block truncate text-meta text-fg-muted">{subtitle}</span>
        )}
      </span>
      {meta != null && <span className="shrink-0 text-meta tabular-nums text-fg-muted">{meta}</span>}
      {trailing != null && <span className="shrink-0">{trailing}</span>}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} w-full text-left`}>
        {content}
      </button>
    )
  }

  return <div className={base}>{content}</div>
}
