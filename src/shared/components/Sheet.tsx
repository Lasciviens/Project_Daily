import type { ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel } from '@headlessui/react'
import { useHistoryDismiss } from '../hooks/useHistoryDismiss'

type SheetSize = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<SheetSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
}

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  className?: string
  footer?: ReactNode
  size?: SheetSize
}

/**
 * Shared bottom-sheet primitive: full-width sheet on mobile (slides up from the
 * bottom with a grab handle), centered dialog on desktop. Presentational only —
 * all business logic lives at the call site.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
  footer,
  size = 'md',
}: SheetProps) {
  // Hardware/browser Back (and iOS edge-swipe) closes the sheet instead of
  // leaving the page (#6).
  useHistoryDismiss(open, onClose)
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[60]">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-ink-950/30 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel
          transition
          className={`flex w-full max-h-[92vh] flex-col overflow-hidden rounded-t-2xl border border-ink-200 bg-cream-50 transition duration-200 data-[closed]:translate-y-4 data-[closed]:opacity-0 sm:rounded-2xl sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95 ${SIZE_MAP[size]}`}
        >
          <div className="sm:hidden flex justify-center pt-2 -mb-1">
            <span className="h-1 w-10 rounded-full bg-ink-200" />
          </div>

          {title && (
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-ink-100 bg-cream-50 px-5 py-3">
              <h2 className="text-base font-semibold text-ink-900">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="press-feedback flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-ink-500 hover:bg-cream-100 hover:text-ink-800"
              >
                <span aria-hidden className="text-lg">&times;</span>
              </button>
            </div>
          )}

          <div className={`flex-1 overflow-y-auto ${className ?? ''}`}>{children}</div>

          {footer && (
            <div className="sticky bottom-0 border-t border-ink-100 bg-cream-50 px-5 py-3">
              {footer}
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
