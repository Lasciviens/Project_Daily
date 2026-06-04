import { create } from 'zustand'

interface UIState {
  isToDoOpen: boolean
  toggleToDo: () => void
  openToDo: () => void
  closeToDo: () => void
}

export const useUIStore = create<UIState>((set) => ({
  isToDoOpen: false,
  toggleToDo: () => set(s => ({ isToDoOpen: !s.isToDoOpen })),
  openToDo: () => set({ isToDoOpen: true }),
  closeToDo: () => set({ isToDoOpen: false }),
}))
