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

// A confirm closed from outside (a route change closes the whole stack) answers
// "no", so the flow awaiting it ends. One already answered keeps its answer.
function answerRemoved(before: ModalEntry[], after: ModalEntry[]) {
  for (const e of before) if (e.request.kind === 'confirm' && !after.includes(e)) e.request.resolve(false)
}

// Bottom-to-top stack of open entity modals. An entry mounts once and unmounts
// on close (never toggles `open` on a live instance) — useHistoryDismiss keys
// its Back entry on that lifecycle.
export const useModalStore = create<ModalStore>((set, get) => ({
  stack: [],
  open: (request) => {
    const key = ++seq
    set(s => ({ stack: [...s.stack, { key, request }] }))
    return key
  },
  close: (key) => {
    const before = get().stack
    const after = key == null ? before.slice(0, -1) : before.filter(e => e.key !== key)
    set({ stack: after })
    answerRemoved(before, after)
  },
  closeAll: () => {
    const before = get().stack
    set({ stack: [] })
    answerRemoved(before, [])
  },
}))
