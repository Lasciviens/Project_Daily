import { create } from 'zustand'
import type { EntityModalRequest } from './types'

export interface ModalEntry { key: number; request: EntityModalRequest }

interface ModalStore {
  stack: ModalEntry[]
  open: (request: EntityModalRequest) => number
  /** Closes one entry (default: the top one). */
  close: (key?: number) => void
  closeAll: () => void
}

let seq = 0

// Bottom-to-top stack of open entity modals. An entry mounts once and unmounts
// on close (never toggles `open` on a live instance) — useHistoryDismiss keys
// its Back entry on that lifecycle.
export const useModalStore = create<ModalStore>((set) => ({
  stack: [],
  open: (request) => {
    const key = ++seq
    set(s => ({ stack: [...s.stack, { key, request }] }))
    return key
  },
  close: (key) => set(s => ({ stack: key == null ? s.stack.slice(0, -1) : s.stack.filter(e => e.key !== key) })),
  closeAll: () => set({ stack: [] }),
}))
