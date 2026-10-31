import type { ReactNode } from 'react'
import { cx } from './cx'
import { PageHeroBand } from './PageHeroArt'

/**
 * Page wrapper: side gutter + vertical rhythm, left-aligned (never centered).
 * `wide` (default) caps at the widest PageBoard — main + three side tracks,
 * 131rem of content plus the 2rem gutters — so a board is never clipped and
 * nothing runs on past it on an ultrawide screen. `narrow` is for forms;
 * `full` removes the cap (a page with its own full-width layout).
 *
 * The container is `@container/page`: a component can adapt to the PAGE's
 * width (`@[61rem]/page:grid-cols-2`) — which the sidebar, a collapsed
 * sidebar and a drawer all change — instead of to the viewport's.
 */
export function PageContainer({
  children, width = 'wide', className,
}: { children: ReactNode; width?: 'narrow' | 'wide' | 'full'; className?: string }) {
  const cap = width === 'narrow' ? 'max-w-3xl' : width === 'wide' ? 'max-w-[135rem]' : ''
  // A short top gap so the header band sits close under the shell (owner, 16.10.2026: "moved a bit up").
  return <div className={cx('@container/page w-full px-4 pb-4 pt-2 sm:px-6 sm:pb-6 sm:pt-3 lg:px-8', cap, className)}>{children}</div>
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
  /**
   * The page's header art (THEME.md §6.5): a motif drawn on the shared
   * 640 × 140 canvas. Given, the visible header sits in one card band with
   * the art behind it — an empty band still shows the art.
   */
  art?: ReactNode
  /**
   * A header that must not move between a page's sections (owner, 31.10.2026: "the layout should not move while
   * navigating between sections"): the title column takes a fixed share of the row (22rem, then whatever is
   * left), so whether the actions fit beside it depends on the page's width only — never on the title's or the
   * subtitle's text. Give it a one-line subtitle (<Truncate>) so its height can't change either.
   */
  steady?: boolean
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
 * With `art`, whatever is visible sits in one band (PageHeroBand) with the
 * page's drawing behind it; with nothing visible the band shows the art alone.
 */
/** `cond && <X/>` hands over `false` when the condition fails; treat it like nothing. */
const shown = (node: ReactNode) => node != null && node !== false && node !== ''

export function PageHeader({ title, subtitle, actions, children, className, showTitle = false, art, steady = false }: PageHeaderProps) {
  const [hasSubtitle, hasActions, hasChildren] = [shown(subtitle), shown(actions), shown(children)]
  const heading = (
    <h1 className={showTitle ? 'text-head font-bold tracking-tight text-fg sm:text-page' : 'sr-only'}>{title}</h1>
  )
  const band = (content: ReactNode) => (art ? <PageHeroBand art={art}>{content}</PageHeroBand> : content)
  if (!showTitle && !hasSubtitle) {
    if (!hasChildren && !hasActions) return art ? <header className={cx('mb-3 sm:mb-4', className)}>{heading}{band(null)}</header> : <header>{heading}</header>
    return (
      <header className={cx('mb-3 sm:mb-4', className)}>
        {heading}
        {band(
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
          </div>,
        )}
      </header>
    )
  }

  return (
    <header className={cx('mb-3 sm:mb-4', className)}>
      {band(
        <>
          <div className={cx('flex flex-wrap justify-between gap-x-4 gap-y-3', showTitle ? 'items-end' : 'items-center')}>
            <div className={cx('min-w-0', steady && 'flex-1 basis-[22rem]')}>
              {heading}
              {hasSubtitle && <p className={cx('text-body text-fg-muted', showTitle && 'mt-0.5')}>{subtitle}</p>}
            </div>
            {hasActions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {hasChildren && <div className={art ? 'mt-3' : 'mt-4'}>{children}</div>}
        </>,
      )}
    </header>
  )
}
