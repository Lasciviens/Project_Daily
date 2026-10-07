import { create } from 'zustand'

// Whether "Platforms left out of stats" is open. Its own tiny store because the
// entry point (the Library settings menu) closes before the dialog does.
export const useTgPlatformPrefs = create<{ open: boolean; setOpen: (open: boolean) => void }>()(set => ({
  open: false,
  setOpen: (open) => set({ open }),
}))
