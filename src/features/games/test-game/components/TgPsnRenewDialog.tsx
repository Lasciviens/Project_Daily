import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { X } from 'lucide-react'
import { PsnNpssoForm } from '../../components/PsnNpssoForm'
import { usePsnProfile, usePsnStatus } from '../../hooks/usePlayStation'
import { psnLine } from './tgConnections'
import { useHistoryDismiss } from '../../../../shared/hooks/useHistoryDismiss'

// Re-authenticating PlayStation at the point you notice it — the one sanctioned
// exception to "connections live in Developer → Connections" (CLAUDE.md).
// The form is the ONE shared PsnNpssoForm, so this can never drift from the
// Connections card or the PlayStation tab's banner.

function Body({ onClose }: { onClose: () => void }) {
  const status = usePsnStatus()
  const profile = usePsnProfile(!!status.data?.connected)
  const line = psnLine(status, profile)
  return (
    <>
      <div className="tg-conn-row mb-3" data-tone={line.tone}>
        <span className="tg-conn-dot" aria-hidden />
        <div className="min-w-0">
          <p className="tg-conn-text text-[13px] font-semibold">{line.text}</p>
          {line.detail && <p className="mt-0.5 text-[12px] text-[var(--tg-muted)] [overflow-wrap:anywhere]">{line.detail}</p>}
        </div>
      </div>
      <p className="mb-3 text-[12.5px] leading-relaxed text-[var(--tg-text-2)]">
        Sony’s login has a reCAPTCHA, so the token can’t renew itself. Paste a fresh one — the old one is
        replaced and nothing else changes.
      </p>
      <div className="tg-npsso"><PsnNpssoForm onConnected={onClose} /></div>
    </>
  )
}

export function TgPsnRenewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useHistoryDismiss(open, onClose)
  return (
    <Dialog open={open} onClose={onClose} className="tg-portal relative z-[70]">
      <DialogBackdrop transition className="fixed inset-0 bg-black/45 transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end justify-center sm:items-center sm:p-4">
        <DialogPanel
          transition
          className="tg-scroll-y max-h-[88dvh] w-full max-w-md rounded-t-[22px] border border-[var(--tg-border-strong)] bg-[var(--tg-panel)] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-4 text-[var(--tg-text)] shadow-[shadow:var(--tg-menu-shadow)] transition duration-200 ease-out data-[closed]:translate-y-6 data-[closed]:opacity-0 sm:rounded-[18px] sm:pb-5"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <DialogTitle className="text-[17px] font-bold">Renew PlayStation token</DialogTitle>
            <button type="button" aria-label="Close" onClick={onClose} className="tg-icon-btn -mr-2 h-11 w-11">
              <X size={18} strokeWidth={2} aria-hidden />
            </button>
          </div>
          {open && <Body onClose={onClose} />}
        </DialogPanel>
      </div>
    </Dialog>
  )
}
