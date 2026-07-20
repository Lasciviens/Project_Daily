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
  const base = `flex items-center gap-2 min-h-[44px] ${className}`

  const content = (
    <>
      {leading != null && <span className="shrink-0">{leading}</span>}
      <span className="flex-1 min-w-0">
        <span className="block truncate text-sm text-ink-900">{title}</span>
        {subtitle != null && (
          <span className="block truncate text-xs text-ink-500">{subtitle}</span>
        )}
      </span>
      {meta != null && <span className="shrink-0 text-xs text-ink-400">{meta}</span>}
      {trailing != null && <span className="shrink-0">{trailing}</span>}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${base} w-full text-left press-feedback`}>
        {content}
      </button>
    )
  }

  return <div className={base}>{content}</div>
}
