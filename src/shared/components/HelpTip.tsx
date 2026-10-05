import { useState, type ReactNode } from 'react'
import { Portal } from '@headlessui/react'
import {
  autoUpdate, flip, offset, safePolygon, shift, useClick, useDismiss, useFloating, useHover, useInteractions, useRole,
} from '@floating-ui/react'
import { cx } from '../ui'

/**
 * A "?" that explains something in plain words. Opens on hover with a mouse
 * (and stays open while the pointer moves into it), on tap or click anywhere,
 * and on Enter/Space; Esc or a press elsewhere closes it. Rendered through
 * Headless UI's Portal so a tap inside it never counts as a click outside an
 * open popup (the TruncateBubble rule).
 */
export function HelpTip({ children, label, className, size = 'md' }: {
  children: ReactNode
  /** What the "?" explains, for screen readers — e.g. "About Reconnect Wi-Fi on wake". */
  label: string
  className?: string
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  })
  const hover = useHover(context, { mouseOnly: true, delay: { open: 120, close: 120 }, handleClose: safePolygon() })
  const click = useClick(context)
  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'dialog' })
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, click, dismiss, role])
  return (
    <>
      <button
        ref={node => refs.setReference(node)}
        type="button"
        aria-label={label}
        {...getReferenceProps({ onClick: e => e.stopPropagation() })}
        className={cx(
          'relative inline-flex shrink-0 items-center justify-center rounded-full border font-bold leading-none transition-colors',
          "after:absolute after:-inset-3 after:content-['']",
          size === 'sm' ? 'h-4 w-4 text-micro' : 'h-5 w-5 text-micro',
          open ? 'border-accent-500 bg-accent-500 text-on-accent' : 'border-line-strong bg-surface text-fg-muted hover:border-accent-500 hover:text-accent-600',
          className,
        )}
      >
        ?
      </button>
      {open && (
        <Portal>
          <div
            ref={node => refs.setFloating(node)}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-popover w-80 max-w-[88vw] rounded-menu border border-line-strong bg-surface p-3 text-meta leading-relaxed text-fg-2 shadow-menu motion-pop-in"
          >
            {children}
          </div>
        </Portal>
      )}
    </>
  )
}
