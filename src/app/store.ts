import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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

interface CalendarState {
  accessToken: string | null
  setAccessToken: (token: string | null) => void
}

export const useCalendarStore = create<CalendarState>((set) => ({
  accessToken: null,
  setAccessToken: (token) => set({ accessToken: token }),
}))

interface TodoistState {
  apiToken: string | null
  setApiToken: (token: string | null) => void
}

export const useTodoistStore = create<TodoistState>()(
  persist(
    (set) => ({
      apiToken: null,
      setApiToken: (token) => set({ apiToken: token }),
    }),
    { name: 'todoist-token' }
  )
)
