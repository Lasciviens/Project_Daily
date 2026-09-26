import { create } from 'zustand'

// Whether the Add game form is open. Its own tiny store because the entry
// points (phone More sheet, sidebar) close or unmount before the form does,
// while the form itself renders with the page's other modals (TgModals).
export const useTgAddGame = create<{ open: boolean; setOpen: (open: boolean) => void }>()(set => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
