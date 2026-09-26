import { useMemo } from 'react'
import { useModalStore } from './modalStore'
import type { EntityModalRequest, RequestOf } from './types'

type ConfirmOptions = Omit<RequestOf<'confirm'>, 'kind' | 'resolve'>

/** Imperative (non-hook) access, for code outside React such as event helpers. */
export const entityModal = {
  open: (request: EntityModalRequest) => useModalStore.getState().open(request),
  close: (key?: number) => useModalStore.getState().close(key),
  /** Resolves true on confirm, false on cancel / Esc / Back / backdrop. */
  confirm: (options: ConfirmOptions) =>
    new Promise<boolean>(resolve => { useModalStore.getState().open({ kind: 'confirm', ...options, resolve }) }),
}

/**
 * The one way to open a shared popup:
 *   const modal = useEntityModal()
 *   modal.open({ kind: 'task', id })
 *   if (!(await modal.confirm({ title: 'Delete this task?' }))) return
 */
export function useEntityModal() {
  return useMemo(() => entityModal, [])
}
