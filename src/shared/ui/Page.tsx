import type { ReactNode } from 'react'
import { cx } from './cx'

/**
 * Page wrapper: side gutter + vertical rhythm, left-aligned (never centered).
 * `width` caps the content column; 'full' is for data-dense dashboards only.
 */
export function PageContainer({
  children, width = 'wide', className,
}: { children: ReactNode; width?: 'narrow' | 'wide' | 'full'; className?: string }) {
  const cap = width === 'narrow' ? 'max-w-3xl' : width === 'wide' ? 'max-w-[88rem]' : ''
  return <div className={cx('w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8', cap, className)}>{children}</div>
}

interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Right side on wide screens, wraps under the title on phones. */
  actions?: ReactNode
  /** A tab row / filter row rendered under the title line. */
  children?: ReactNode
  className?: string
}

export function PageHeader({ title, subtitle, actions, children, className }: PageHeaderProps) {
  return (
    <header className={cx('mb-4 sm:mb-6', className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-head font-bold tracking-tight text-fg sm:text-page">{title}</h1>
          {subtitle != null && <p className="mt-0.5 text-body text-fg-muted">{subtitle}</p>}
        </div>
        {actions != null && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children != null && <div className="mt-4">{children}</div>}
    </header>
  )
}
