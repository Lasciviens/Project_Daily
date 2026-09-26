import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useHistoryDismiss } from '../../../../shared/hooks/useHistoryDismiss'

interface Props {
  open: boolean
  title: string
  message?: string
  confirmLabel: string
  /** Red confirm button (a delete) instead of the accent one. */
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
  /** A second, lesser action under the two main buttons (e.g. "Delete anyway"). */
  secondary?: { label: string; onClick: () => void; danger?: boolean }
}

/**
 * The shared ConfirmDialog in this page's tokens. It portals to <body>, so it
 * carries `tg-portal` (else every --tg-* token is undefined there). z-50: over
 * the phone sheet and the overlay (both z-40).
 */
export function TgConfirmDialog({ open, title, message, confirmLabel, danger, onConfirm, onClose, secondary }: Props) {
  useHistoryDismiss(open, onClose)
  return (
    <Dialog open={open} onClose={onClose} className="tg-portal relative z-50">
      <DialogBackdrop transition className="fixed inset-0 bg-black/50 backdrop-blur-[2px] transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4">
        <DialogPanel
          transition
          className="w-full max-w-full rounded-t-[18px] border border-[var(--tg-border)] bg-[var(--tg-panel)] pb-[env(safe-area-inset-bottom)] shadow-[shadow:var(--tg-menu-shadow)] transition duration-200 data-[closed]:translate-y-4 data-[closed]:opacity-0 sm:max-w-sm sm:rounded-[18px] sm:pb-0 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95"
        >
          <div className="px-5 pb-4 pt-5">
            <DialogTitle className="text-[16px] font-bold text-[var(--tg-text)]">{title}</DialogTitle>
            {message && <p className="mt-2 whitespace-pre-line text-[13px] leading-[1.5] text-[var(--tg-text-2)]">{message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2.5 border-t border-[var(--tg-border)] px-5 py-4">
            <button type="button" onClick={onClose} className="tg-btn tg-btn-secondary">Cancel</button>
            <button
              type="button"
              onClick={() => { onConfirm(); onClose() }}
              className={`tg-btn ${danger ? 'bg-[var(--tg-red)] text-white' : 'tg-btn-primary'}`}
            >
              {confirmLabel}
            </button>
            {secondary && (
              <button
                type="button"
                onClick={() => { secondary.onClick(); onClose() }}
                className={`col-span-2 min-h-[44px] rounded-[12px] text-[13.5px] font-semibold ${secondary.danger ? 'text-[var(--tg-red)]' : 'text-[var(--tg-text-2)]'} [@media(hover:hover)]:hover:bg-[var(--tg-hover)]`}
              >
                {secondary.label}
              </button>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
