import { DialogTitle } from '@headlessui/react'
import { ModalShell } from '../modals/ModalShell'
import { Button } from '../ui/Button'

// Controlled confirm dialog — replaces native window.confirm() (blocking,
// unstyled, and an OS sheet in an installed PWA). Prefer the promise form,
// `await useEntityModal().confirm({ title })`, which needs no local state.
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
    <ModalShell
      open={open}
      onClose={onClose}
      size="xs"
      layer="confirm"
      bodyClassName="px-5 pt-3 pb-2 sm:pt-5"
      footer={
        <div className="flex gap-2">
          <Button block onClick={onClose}>{cancelLabel}</Button>
          <Button block variant={destructive ? 'danger' : 'primary'} onClick={() => { onConfirm(); onClose() }}>
            {confirmLabel}
          </Button>
        </div>
      }
    >
      {/* DialogTitle names the dialog for assistive tech. */}
      <DialogTitle as="h2" className="text-title font-semibold text-fg">{title}</DialogTitle>
      {/* pre-line so a caller can lay a longer message out in paragraphs. */}
      {message && <p className="mt-1.5 whitespace-pre-line text-body text-fg-muted">{message}</p>}
    </ModalShell>
  )
}
