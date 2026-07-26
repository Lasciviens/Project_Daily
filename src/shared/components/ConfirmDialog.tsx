import { Dialog, DialogPanel, DialogBackdrop } from '@headlessui/react'

// Small reusable confirm dialog — replaces native window.confirm() (which is
// blocking, unstyled, and in an installed PWA renders as an OS sheet that
// breaks out of the app). Uses the repo's standard Headless UI Dialog pattern
// (Escape / focus-trap / portal handled).
//
// This is the SHARED copy. An identical component already existed inside the
// Food feature (features/recipes/components/ConfirmDialog.tsx) — it is left
// alone here so the two features don't collide; re-point it at this one the
// next time that folder is touched.
interface Props {
  open: boolean
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onClose: () => void
}

export function ConfirmDialog({
  open, title, message,
  confirmLabel = 'Delete', cancelLabel = 'Cancel',
  destructive = true, onConfirm, onClose,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} className="relative z-[80]">
      <DialogBackdrop transition className="fixed inset-0 bg-ink-950/40 backdrop-blur-sm transition duration-200 data-[closed]:opacity-0" />
      <div className="fixed inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <DialogPanel transition className="w-full rounded-t-2xl sm:rounded-2xl sm:max-w-xs bg-cream-50 border border-ink-200 transition duration-200 data-[closed]:opacity-0 data-[closed]:translate-y-4 sm:data-[closed]:translate-y-0 sm:data-[closed]:scale-95">
          <div className="px-5 pt-5 pb-4">
            <h2 className="text-base font-bold text-ink-900">{title}</h2>
            {message && <p className="text-sm text-ink-500 mt-1.5">{message}</p>}
          </div>
          <div className="px-5 py-4 border-t border-ink-100 flex gap-3">
            <button onClick={onClose} className="flex-1 min-h-[44px] text-sm font-medium text-ink-600 border border-ink-200 rounded-xl hover:bg-cream-100">
              {cancelLabel}
            </button>
            <button
              onClick={() => { onConfirm(); onClose() }}
              className={`flex-1 min-h-[44px] text-sm font-semibold rounded-xl text-white transition-colors ${
                destructive ? 'bg-red-500 hover:bg-red-600' : 'bg-accent-500 hover:bg-accent-600'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}
