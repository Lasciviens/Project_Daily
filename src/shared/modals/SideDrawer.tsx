import type { CSSProperties, ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { X } from 'lucide-react'
import { useHistoryDismiss } from '../hooks/useHistoryDismiss'
import { useSheetDrag } from '../hooks/useSheetDrag'
import { useBreakpoint } from '../hooks/useBreakpoint'
import { cx } from '../ui/cx'

export interface SideDrawerProps {
  open: boolean
  onClose: () => void
  /** Standard header title. Omit `title` to render your own header inside `children`. */
  title?: ReactNode
  /** Header controls left of the close button. */
  headerActions?: ReactNode
  /** Header content under the title row (filters, chips). */
  headerExtra?: ReactNode
  /** Tailwind width classes for the tablet/desktop drawer. */
  widthClassName?: string
  /** Phone sheet height (CSS length). */
  phoneHeight?: string
  /** Phone only: inline style for the sheet, e.g. lifting it above the keyboard. */
  phoneStyle?: CSSProperties
  /** Label for the dialog when there is no visible title. */
  ariaLabel?: string
  children: ReactNode
}

/**
 * Right-edge, full-height drawer (THEME.md §8) for the assistant and the
 * requests backlog; a bottom sheet with a drag handle on phones. Back closes
 * it (only when it is the top overlay), Esc and the scrim too; focus is
 * trapped while it is open and returns to the trigger on close.
 */
export function SideDrawer({
  open, onClose, title, headerActions, headerExtra,
  widthClassName = 'w-[28rem]', phoneHeight = '88dvh', phoneStyle, ariaLabel, children,
}: SideDrawerProps) {
  const phone = useBreakpoint() === 'phone'
  useHistoryDismiss(open, onClose)
  const { backdropRef, setPanelEl, handleProps } = useSheetDrag(open && phone, onClose)

  return (
    <Dialog open={open} onClose={onClose} className="relative z-drawer" aria-label={title == null ? ariaLabel : undefined}>
      <DialogBackdrop
        ref={backdropRef}
        transition
        className="fixed inset-0 bg-scrim/25 transition duration-200 data-[closed]:opacity-0 dark:bg-scrim/50"
      />
      <DialogPanel
        ref={setPanelEl}
        transition
        style={phone ? { height: phoneHeight, ...phoneStyle } : undefined}
        className={cx(
          'fixed flex flex-col overflow-hidden border-line bg-surface shadow-menu',
          'transition duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-[leave]:duration-200 data-[leave]:ease-in',
          phone
            ? 'inset-x-0 bottom-0 max-h-[calc(100dvh-env(safe-area-inset-top)-8px)] rounded-t-sheet border-x border-t data-[closed]:translate-y-full'
            : cx('inset-y-0 right-0 max-w-[calc(100vw-3rem)] border-l pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] data-[closed]:translate-x-full', widthClassName),
        )}
      >
        {phone && (
          <div {...handleProps} className="flex shrink-0 justify-center pb-1 pt-2">
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
        )}
        {title != null && (
          <header {...(phone ? handleProps : {})} className="shrink-0 border-b border-line">
            <div className="flex min-h-[56px] items-center gap-2 pl-4 pr-2 sm:pl-5">
              <DialogTitle className="min-w-0 flex-1 truncate text-title font-semibold text-fg">{title}</DialogTitle>
              {headerActions}
              <button type="button" onClick={onClose} aria-label="Close" className="icon-btn shrink-0">
                <X className="h-[18px] w-[18px]" aria-hidden />
              </button>
            </div>
            {headerExtra}
          </header>
        )}
        {children}
      </DialogPanel>
    </Dialog>
  )
}
