import { useState, type ReactNode } from 'react'
import { Portal } from '@headlessui/react'
import {
  autoUpdate, flip, offset, safePolygon, shift, useClick, useDismiss, useFloating, useHover, useInteractions, useRole,
  type Placement,
} from '@floating-ui/react'
import { cx } from '../ui'

/**
 * Detail on demand (THEME §6.6 W5): a button whose panel opens on hover with a
 * mouse (and stays open while the pointer moves into it), on tap or click
 * anywhere, and on Enter/Space; Esc or a press elsewhere closes it. The panel
 * renders only while open, through Headless UI's Portal, so a tap inside it
 * never counts as a click outside an open popup (the TruncateBubble rule).
 * `HelpTip` is this with a "?" button.
 */
export function HoverPeek({ trigger, children, label, className, panelClassName = 'w-72', placement = 'bottom-start' }: {
  /** The button's content; a function gets whether the panel is open. */
  trigger: ReactNode | ((open: boolean) => ReactNode)
  /** The panel's content, rendered only while open. */
  children: ReactNode
  /** Accessible name when the button's own text doesn't say it (an icon, a "?"). */
  label?: string
  className?: string | ((open: boolean) => string)
  /** Width and extra text styles of the panel. */
  panelClassName?: string
  placement?: Placement
}) {
  const [open, setOpen] = useState(false)
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
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
        className={typeof className === 'function' ? className(open) : className}
      >
        {typeof trigger === 'function' ? trigger(open) : trigger}
      </button>
      {open && (
        <Portal>
          <div
            ref={node => refs.setFloating(node)}
            style={floatingStyles}
            {...getFloatingProps()}
            className={cx('z-popover max-w-[88vw] rounded-menu border border-line-strong bg-surface p-3 text-meta text-fg-2 shadow-menu motion-pop-in', panelClassName)}
          >
            {children}
          </div>
        </Portal>
      )}
    </>
  )
}
