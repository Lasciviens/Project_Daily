import type { ElementType, ReactNode, ComponentPropsWithoutRef } from 'react'
import { cx } from './cx'
import { Truncate } from './Truncate'

type CardProps<T extends ElementType> = {
  as?: T
  interactive?: boolean
  padded?: boolean
  className?: string
  children?: ReactNode
} & Omit<ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>

/** The one panel surface: 18px radius, hairline border, soft shadow. */
export function Card<T extends ElementType = 'section'>({
  as, interactive = false, padded = true, className, children, ...rest
}: CardProps<T>) {
  const Tag = (as ?? 'section') as ElementType
  return (
    <Tag className={cx(interactive ? 'card-interactive text-left' : 'card', padded && 'p-4 sm:p-5', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cx('section-label', className)}>{children}</h3>
}

interface CardHeaderProps {
  title: ReactNode
  /** Small leading icon, rendered in a tinted chip. */
  icon?: ReactNode
  subtitle?: ReactNode
  /** Right-aligned actions (links, icon buttons, a count badge). */
  action?: ReactNode
  /** 'label' = uppercase eyebrow (dense cards); 'title' = 15px heading. */
  variant?: 'label' | 'title'
  /** Let a long title/subtitle wrap instead of cutting it off, and drop the
   *  action onto its own line when the row is too narrow (phones). Off by
   *  default: most headers are short and read best on one line. */
  wrap?: boolean
  className?: string
}

export function CardHeader({ title, icon, subtitle, action, variant = 'title', wrap = false, className }: CardHeaderProps) {
  return (
    <header className={cx('mb-3 flex min-h-[28px] items-center gap-2.5', wrap && 'flex-wrap', className)}>
      {icon != null && (
        <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-control bg-accent-50 text-accent-600 [&_svg]:h-4 [&_svg]:w-4">
          {icon}
        </span>
      )}
      <div className={cx('flex-1', wrap ? 'min-w-[12rem]' : 'min-w-0')}>
        {wrap ? (
          <>
            <h3 className={cx(variant === 'label' ? 'section-label' : 'text-lead font-semibold text-fg', 'break-words')}>{title}</h3>
            {subtitle != null && <p className="break-words text-meta text-fg-muted">{subtitle}</p>}
          </>
        ) : (
          <>
            <Truncate as="h3" className={variant === 'label' ? 'section-label' : 'text-lead font-semibold text-fg'}>{title}</Truncate>
            {subtitle != null && <Truncate as="p" className="text-meta text-fg-muted">{subtitle}</Truncate>}
          </>
        )}
      </div>
      {action != null && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </header>
  )
}
