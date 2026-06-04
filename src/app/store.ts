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
  accessToken:         string | null
  expiresAt:           number | null   // ms timestamp
  selectedCalendarIds: string[] | null // null = primary only
  setAccessToken:          (token: string | null, expiresIn?: number) => void
  setSelectedCalendarIds:  (ids: string[] | null) => void
}

export const useCalendarStore = create<CalendarState>()(
  persist(
    (set) => ({
      accessToken:         null,
      expiresAt:           null,
      selectedCalendarIds: null,
      setAccessToken: (token, expiresIn) => set({
        accessToken: token,
        expiresAt:   token && expiresIn ? Date.now() + expiresIn * 1000 : null,
      }),
      setSelectedCalendarIds: (ids) => set({ selectedCalendarIds: ids }),
    }),
    { name: 'calendar-token' }
  )
)
