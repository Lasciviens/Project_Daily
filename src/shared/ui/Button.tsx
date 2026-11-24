import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cx } from './cx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

// Written out in full: Tailwind keeps a class from index.css's component
// layer only when it finds its name in the source — `btn-${variant}` left
// `.btn-danger` out, so every danger button rendered unstyled.
const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'sm'
  icon?: ReactNode
  loading?: boolean
  block?: boolean
  /**
   * The full description of a short button (owner, 24.11.2026: a button is an icon, a symbol or 1–2 words): its accessible
   * name, its `title` on hover and, on touch, a long press's bubble (`app/longPressTips.ts`). Start it with the button's own
   * word ("Sell" → "Sell or give away"). A button with an icon, a tip and no words is square.
   */
  tip?: string
}

/** 44px button (36px `sm` on pointer devices). One primary per view. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, block, className, children, disabled, type = 'button', tip, ...rest },
  ref,
) {
  const iconOnly = tip != null && (children == null || children === false) && icon != null
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={tip}
      title={tip}
      className={cx(VARIANT_CLASS[variant], size === 'sm' && 'btn-sm', block && 'w-full', iconOnly && 'aspect-square justify-center !px-0', className)}
      {...rest}
    >
      {loading
        ? <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        : icon != null && <span aria-hidden className={cx(!iconOnly && '-ml-0.5', '[&_svg]:h-4 [&_svg]:w-4')}>{icon}</span>}
      {children}
    </button>
  )
})

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: an icon-only control needs an accessible name — also its hover title and, on touch, its long-press bubble. */
  label: string
  bordered?: boolean
  /** `sm`: 36px (44 on touch), the height of a small button — for a bar of small controls. */
  size?: 'md' | 'sm'
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, bordered, size = 'md', className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(bordered ? 'icon-btn-bordered' : 'icon-btn', size === 'sm' && 'h-9 w-9 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11', '[&_svg]:h-[18px] [&_svg]:w-[18px]', className)}
      {...rest}
    >
      {children}
    </button>
  )
})
