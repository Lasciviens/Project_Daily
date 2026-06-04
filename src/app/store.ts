import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface UIState {
  isToDoOpen: boolean
  isAIOpen:   boolean
  toggleToDo: () => void
  openToDo:   () => void
  closeToDo:  () => void
  toggleAI:   () => void
  openAI:     () => void
  closeAI:    () => void
}

export const useUIStore = create<UIState>((set) => ({
  isToDoOpen: false,
  isAIOpen:   false,
  toggleToDo: () => set(s => ({ isToDoOpen: !s.isToDoOpen, isAIOpen: false })),
  openToDo:   () => set({ isToDoOpen: true,  isAIOpen: false }),
  closeToDo:  () => set({ isToDoOpen: false }),
  toggleAI:   () => set(s => ({ isAIOpen: !s.isAIOpen, isToDoOpen: false })),
  openAI:     () => set({ isAIOpen: true,  isToDoOpen: false }),
  closeAI:    () => set({ isAIOpen: false }),
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
