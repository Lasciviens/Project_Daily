import { useRef } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { EntityModalProps } from './types'

/** The `confirm` kind: resolves the caller's promise exactly once. */
export function ConfirmModal({ request, onClose }: EntityModalProps<'confirm'>) {
  const settled = useRef(false)
  const settle = (ok: boolean) => {
    if (!settled.current) { settled.current = true; request.resolve(ok) }
  }
  return (
    <ConfirmDialog
      open
      title={request.title}
      message={request.message}
      confirmLabel={request.confirmLabel}
      cancelLabel={request.cancelLabel}
      destructive={request.destructive ?? true}
      onConfirm={() => settle(true)}
      onClose={() => { settle(false); onClose() }}
    />
  )
}
