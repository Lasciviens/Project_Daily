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
  /** The page name. Visually hidden (the shell already shows it) unless `showTitle`. */
  title: ReactNode
  subtitle?: ReactNode
  /** Right side of the first row; its own row on phones. */
  actions?: ReactNode
  /** A tab row / filter row. It takes the first row itself when nothing else is visible there. */
  children?: ReactNode
  className?: string
  /**
   * The shell (top bar from 768px, phone header below it) already shows the
   * route name, so the H1 is visually hidden at every width and only read by
   * screen readers (THEME.md §6.2). Set this when the title is content rather
   * than the route name — e.g. Daily's date nav.
   */
  showTitle?: boolean
}

/**
 * Page header: the (screen-reader) H1 plus the page's own controls.
 *
 * Layouts, so a hidden title never leaves an empty line:
 * - visible title or subtitle → that on the left, `actions` on the right,
 *   `children` on the next row;
 * - neither → `children` (left) and `actions` (right) share the first row;
 *   they wrap when the row is too narrow, and on phones the actions get
 *   their own row above the children;
 * - nothing visible at all → only the hidden H1, no margin.
 */
/** `cond && <X/>` hands over `false` when the condition fails; treat it like nothing. */
const shown = (node: ReactNode) => node != null && node !== false && node !== ''

export function PageHeader({ title, subtitle, actions, children, className, showTitle = false }: PageHeaderProps) {
  const [hasSubtitle, hasActions, hasChildren] = [shown(subtitle), shown(actions), shown(children)]
  const heading = (
    <h1 className={showTitle ? 'text-head font-bold tracking-tight text-fg sm:text-page' : 'sr-only'}>{title}</h1>
  )
  if (!showTitle && !hasSubtitle) {
    if (!hasChildren && !hasActions) return <header>{heading}</header>
    return (
      <header className={cx('mb-4 sm:mb-6', className)}>
        {heading}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {hasChildren && <div className="min-w-0 flex-[1_1_auto]">{children}</div>}
          {hasActions && (
            <div className={cx(
              'ml-auto flex flex-wrap items-center gap-2',
              // Phones keep the actions on their own right-aligned row above the tabs.
              hasChildren && 'max-md:order-first max-md:basis-full max-md:justify-end',
            )}>
              {actions}
            </div>
          )}
        </div>
      </header>
    )
  }

  return (
    <header className={cx('mb-4 sm:mb-6', className)}>
      <div className={cx('flex flex-wrap justify-between gap-x-4 gap-y-3', showTitle ? 'items-end' : 'items-center')}>
        <div className="min-w-0">
          {heading}
          {hasSubtitle && <p className={cx('text-body text-fg-muted', showTitle && 'mt-0.5')}>{subtitle}</p>}
        </div>
        {hasActions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {hasChildren && <div className="mt-4">{children}</div>}
    </header>
  )
}
