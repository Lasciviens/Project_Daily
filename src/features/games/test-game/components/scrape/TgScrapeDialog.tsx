import type { ReactNode } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { X } from 'lucide-react'
import { useTgBreakpoint } from '../../useTgBreakpoint'
import { TgMobileSheet } from '../TgMobileSheet'
import { useHistoryDismiss } from '../../../../../shared/hooks/useHistoryDismiss'

/**
 * The Scrape page's pop-ups: the phone's drag-to-close bottom sheet, a centred
 * panel on wider screens. Same props either way, so a caller never branches.
 */
export function TgScrapeDialog({ open, onClose, title, footer, children, wide = false }: {
  open: boolean
  onClose: () => void
  title: string
  footer?: ReactNode
  children: ReactNode
  /** A roomier panel (settings) on wide screens. */
  wide?: boolean
}) {
  const bp = useTgBreakpoint()
  // The phone sheet handles Back itself.
  useHistoryDismiss(open && bp !== 'mobile', onClose)
  if (bp === 'mobile') return <TgMobileSheet open={open} onClose={onClose} title={title} footer={footer}>{children}</TgMobileSheet>
  return (
    <Dialog open={open} onClose={onClose} className="tg-portal relative z-[60]">
      <DialogBackdrop transition className="fixed inset-0 bg-black/50 backdrop-blur-[2px] transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-center justify-center p-6">
        <DialogPanel
          transition
          className={`flex max-h-[86dvh] w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} flex-col overflow-hidden rounded-[20px] border border-[var(--tg-border-strong)] bg-[var(--tg-panel)] text-[var(--tg-text)] shadow-[shadow:var(--tg-menu-shadow)] transition duration-200 data-[closed]:scale-95 data-[closed]:opacity-0`}
        >
          <div className="flex min-h-[56px] shrink-0 items-center justify-between gap-3 border-b border-[var(--tg-border)] pl-5 pr-2">
            <DialogTitle className="text-[16px] font-bold">{title}</DialogTitle>
            <button type="button" onClick={onClose} aria-label="Close" className="tg-icon-btn">
              <X className="h-5 w-5" strokeWidth={2} aria-hidden />
            </button>
          </div>
          <div className="tg-scroll-y min-h-0 flex-1 px-5 py-4">{children}</div>
          {footer && <div className="shrink-0 border-t border-[var(--tg-border)] px-5 py-3">{footer}</div>}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
