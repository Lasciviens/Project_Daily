import type { ReactNode } from 'react'
import { cx } from '../ui'
import { HoverPeek } from './HoverPeek'

/**
 * A "?" that explains something in plain words — a `HoverPeek`: opens on
 * hover with a mouse, on tap or click anywhere, and on Enter/Space; Esc or a
 * press elsewhere closes it.
 */
export function HelpTip({ children, label, className, size = 'md' }: {
  children: ReactNode
  /** What the "?" explains, for screen readers — e.g. "About Reconnect Wi-Fi on wake". */
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <HoverPeek
      label={label}
      trigger="?"
      panelClassName="w-80 leading-relaxed"
      className={open => cx(
        'relative inline-flex shrink-0 items-center justify-center rounded-full border font-bold leading-none transition-colors',
        "after:absolute after:-inset-3 after:content-['']",
        size === 'sm' ? 'h-4 w-4 text-micro' : 'h-5 w-5 text-micro',
        open ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line-strong bg-surface text-fg-muted hover:border-accent-500 hover:text-accent-600',
        className,
      )}
    >
      {children}
    </HoverPeek>
  )
}
