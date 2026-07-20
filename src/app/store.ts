import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyTheme as applyAccentTheme } from '../shared/components/ThemeSwitcher'

interface UIState {
  isDevRequestsOpen: boolean
  isAIOpen:        boolean
  isCommandBarOpen:boolean
  // Global chrome scroll cues (mobile hide-on-scroll header + scroll-depth
  // shadow). Lives in the store so BOTH the app's <main> scroller AND the
  // Personal group's own inner scroll container (PersonalLayout) can drive the
  // same header — on /daily,/shop,/recipes <main> never scrolls, so a header
  // that only watched <main> stayed permanently pinned there.
  chromeHidden:    boolean
  chromeScrolled:  boolean
  toggleDevRequests: () => void
  closeDevRequests:  () => void
  toggleAI:      () => void
  openAI:        () => void
  closeAI:       () => void
  openCommandBar:  () => void
  closeCommandBar: () => void
  reportScroll:  (y: number) => void
  resetChrome:   () => void
}

// Last observed scrollTop — module-scoped (not reactive state; only the derived
// hidden/scrolled booleans need to trigger re-renders).
let lastChromeY = 0

export const useUIStore = create<UIState>((set) => ({
  isDevRequestsOpen: false,
  isAIOpen:         false,
  isCommandBarOpen: false,
  chromeHidden:     false,
  chromeScrolled:   false,
  toggleDevRequests: () => set(s => ({ isDevRequestsOpen: !s.isDevRequestsOpen, isAIOpen: false })),
  closeDevRequests:  () => set({ isDevRequestsOpen: false }),
  toggleAI:      () => set(s => ({ isAIOpen: !s.isAIOpen, isDevRequestsOpen: false })),
  openAI:        () => set({ isAIOpen: true,  isDevRequestsOpen: false }),
  closeAI:       () => set({ isAIOpen: false }),
  openCommandBar:  () => set({ isCommandBarOpen: true }),
  closeCommandBar: () => set({ isCommandBarOpen: false }),
  reportScroll: (y) => set(s => {
    const last = lastChromeY
    lastChromeY = y
    const scrolled = y > 8
    // Hide once past a threshold scrolling down; show on any real upward move.
    // Small dead-zone so scroll jitter can't flap the header.
    let hidden = s.chromeHidden
    if (y > last + 6 && y > 64) hidden = true
    else if (y < last - 6) hidden = false
    if (scrolled === s.chromeScrolled && hidden === s.chromeHidden) return s
    return { chromeScrolled: scrolled, chromeHidden: hidden }
  }),
  resetChrome: () => { lastChromeY = 0; set({ chromeHidden: false, chromeScrolled: false }) },
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

// ─── Theme ────────────────────────────────────────────────────────────────────

export type ThemePreference = 'light' | 'dark' | 'system'

interface ThemeState {
  theme:    ThemePreference
  setTheme: (theme: ThemePreference) => void
}

function applyTheme(theme: ThemePreference) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  // Re-apply the user's picked accent color for whichever mode we just
  // switched to — applyAccentTheme reads document.documentElement's .dark
  // class itself, so calling it AFTER the toggle above picks the right
  // light/dark variant. Without this, switching Light/Dark mid-session left
  // accent's inline-style variables stuck on whatever mode was active when
  // the page first loaded, until the next full reload.
  applyAccentTheme(localStorage.getItem('accent-theme') ?? 'orange')
}

// Storage key matches the inline script in index.html, which stamps .dark
// on <html> before first paint (reading the same persisted value) so the
// page never flashes the wrong theme for a frame while React boots.
export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => { applyTheme(theme); set({ theme }) },
    }),
    { name: 'theme-preference' }
  )
)

// The inline script only fires once, on load — this keeps the DOM in sync
// if the OS-level preference flips while the tab stays open (e.g. macOS's
// automatic light→dark at sunset) and the user hasn't overridden to an
// explicit light/dark choice.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useThemeStore.getState().theme === 'system') applyTheme('system')
  })
}
