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

// ─── Toast ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'loading' | 'info' | 'warning'

export interface Toast {
  id:      string
  type:    ToastType
  message: string
}

interface ToastState {
  toasts: Toast[]
  show:   (message: string, type?: ToastType, durationMs?: number) => string
  dismiss:(id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, type = 'info', durationMs) => {
    const id = Math.random().toString(36).slice(2)
    set(s => ({ toasts: [...s.toasts, { id, type, message }] }))
    // loading toasts stay until manually dismissed; others auto-dismiss
    const ms = durationMs ?? (type === 'error' ? 5000 : type === 'loading' ? 0 : 3000)
    if (ms > 0) setTimeout(() => get().dismiss(id), ms)
    return id
  },
  dismiss: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

// Convenience helpers — import these instead of the store directly
export const toast = {
  success: (msg: string) => useToastStore.getState().show(msg, 'success'),
  error:   (msg: string) => useToastStore.getState().show(msg, 'error'),
  loading: (msg: string) => useToastStore.getState().show(msg, 'loading'),
  info:    (msg: string) => useToastStore.getState().show(msg, 'info'),
  warning: (msg: string) => useToastStore.getState().show(msg, 'warning'),
  dismiss: (id: string)  => useToastStore.getState().dismiss(id),
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

interface CalendarState {
  accessToken:         string | null
  expiresAt:           number | null
  selectedCalendarIds: string[] | null
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
