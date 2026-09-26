import type { ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useHistoryDismiss } from '../../../../shared/hooks/useHistoryDismiss'
import { useTgSheetDrag } from './useTgSheetDrag'

// The phone's bottom sheet (filters, More). `tg-portal` sits on the Dialog
// root because Headless UI mounts it on <body>, outside `.tg-root`, where the
// design tokens would otherwise not resolve.
export function TgMobileSheet({
  open, onClose, title, action, footer, children,
}: {
  open: boolean
  onClose: () => void
  title: string
  /** Small control right of the title (e.g. "Reset"). */
  action?: ReactNode
  /** Pinned below the scrolling body, above the home indicator. */
  footer?: ReactNode
  children: ReactNode
}) {
  // Android Back / the iOS edge swipe closes the sheet instead of leaving the page.
  useHistoryDismiss(open, onClose)
  // Drag the handle/title down (or the body, from its top) to close.
  const { setPanelEl, setBodyEl, backdropRef, handleProps } = useTgSheetDrag(open, onClose)

  return (
    <Dialog open={open} onClose={onClose} className="tg-portal relative z-[60]">
      <DialogBackdrop
        ref={backdropRef}
        transition
        className="fixed inset-0 bg-black/45 transition duration-200 ease-out data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end justify-center">
        <DialogPanel
          ref={setPanelEl}
          transition
          className="flex max-h-[88dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[22px] border border-b-0 border-[var(--tg-border-strong)] bg-[var(--tg-panel)] text-[var(--tg-text)] shadow-[shadow:var(--tg-menu-shadow)] transition duration-300 ease-out data-[closed]:translate-y-full"
        >
          <div {...handleProps} className="cursor-grab select-none active:cursor-grabbing">
            <div className="flex justify-center pb-1 pt-2" aria-hidden>
              <span className="h-1 w-10 rounded-full bg-[var(--tg-border-strong)]" />
            </div>
            <div className="flex min-h-[48px] items-center justify-between gap-3 px-5">
              <DialogTitle className="text-[17px] font-bold">{title}</DialogTitle>
              {action}
            </div>
          </div>
          <div
            ref={setBodyEl}
            className={`tg-scroll-y min-h-0 flex-1 px-5 ${
              footer ? 'pb-4' : 'pb-[calc(1rem+env(safe-area-inset-bottom))]'
            }`}
          >
            {children}
          </div>
          {footer && (
            <div className="border-t border-[var(--tg-border)] px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
              {footer}
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
