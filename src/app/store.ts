import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { applyAccent, DEFAULT_ACCENT, resolveAccent, type AccentName } from '../shared/theme/accent'

interface UIState {
  isDevRequestsOpen: boolean
  isAIOpen:        boolean
  isCommandBarOpen:boolean
  // Global chrome scroll cues (mobile hide-on-scroll header + scroll-depth
  // shadow), driven by <main>'s scroll.
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

// ─── Sidebar ──────────────────────────────────────────────────────────────────

interface SidebarState {
  /** The desktop sidebar is folded to its icon rail (the persisted preference). */
  collapsed: boolean
  /**
   * A page that starts with the sidebar folded (`collapseSidebar` in the nav
   * registry, e.g. Games) holds its own state here while it is open, so the
   * toggle there never changes the preference other pages use. null = none.
   */
  pageCollapsed: boolean | null
  toggle: () => void
  /** Called on every route change: whether the new page folds the sidebar by default. */
  enterRoute: (collapsesByDefault: boolean) => void
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      pageCollapsed: null,
      toggle: () => set(s => (s.pageCollapsed != null ? { pageCollapsed: !s.pageCollapsed } : { collapsed: !s.collapsed })),
      enterRoute: (collapsesByDefault) => set({ pageCollapsed: collapsesByDefault ? true : null }),
    }),
    { name: 'app-sidebar', partialize: (s) => ({ collapsed: s.collapsed }) },
  ),
)

/** Whether the desktop sidebar is folded right now (the page's own state wins). */
export const selectSidebarCollapsed = (s: SidebarState) => s.pageCollapsed ?? s.collapsed

// ─── Toast ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'loading' | 'info' | 'warning'

export interface ToastAction { label: string; onClick: () => void }

export interface Toast {
  id:      string
  type:    ToastType
  message: string
  action?: ToastAction   // e.g. an "Undo" button on a destructive-action snackbar
}

interface ToastState {
  toasts: Toast[]
  show:   (message: string, type?: ToastType, durationMs?: number, action?: ToastAction) => string
  dismiss:(id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (message, type = 'info', durationMs, action) => {
    const id = Math.random().toString(36).slice(2)
    set(s => ({ toasts: [...s.toasts, { id, type, message, action }] }))
    // loading toasts stay until manually dismissed; action snackbars linger
    // longer (you need time to hit Undo); others auto-dismiss.
    const ms = durationMs ?? (type === 'loading' ? 0 : action ? 6000 : type === 'error' ? 5000 : 3000)
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
  // Undo snackbar — show after a destructive action instead of a blocking
  // confirm dialog. onUndo runs if the user taps "Undo" before it expires.
  undo: (msg: string, onUndo: () => void, durationMs = 6000) => {
    const id = useToastStore.getState().show(msg, 'info', durationMs, {
      label: 'Undo',
      onClick: () => { onUndo(); useToastStore.getState().dismiss(id) },
    })
    return id
  },
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
/** Settings → Appearance → Display size: the root font size in %. The app is
 *  rem-based and PageBoard steps are measured in rem, so 90 % on a monitor
 *  shows the next wider layout (like 90 % browser zoom). */
export type DisplayScale = 80 | 90 | 100 | 110 | 125
export const DISPLAY_SCALES: DisplayScale[] = [80, 90, 100, 110, 125]
const resolveScale = (v: unknown): DisplayScale => (DISPLAY_SCALES.includes(v as DisplayScale) ? v as DisplayScale : 100)

interface ThemeState {
  theme:     ThemePreference
  accent:    AccentName
  scale:     DisplayScale
  setTheme:  (theme: ThemePreference) => void
  setAccent: (accent: AccentName) => void
  setScale:  (scale: DisplayScale) => void
}

/** Root font size; index.html's inline script sets the same value before first paint. */
function applyScale(scale: DisplayScale) {
  document.documentElement.style.fontSize = scale === 100 ? '' : `${scale}%`
}

function applyTheme(theme: ThemePreference, accent: AccentName) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
  // The accent's light and dark variants are inline styles on <html>, so they
  // must be re-applied AFTER the .dark toggle, or the old mode's accent sticks.
  applyAccent(accent)
}

// Storage key matches the inline script in index.html, which stamps .dark
// on <html> before first paint (reading the same persisted value) so the
// page never flashes the wrong theme for a frame while React boots.
// version 1 (2026-09-26): the accent moved in here from its own
// 'accent-theme' key, and everyone starts on the new default (blue) once —
// the whole site was re-themed around it.
export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme:  'system',
      accent: DEFAULT_ACCENT,
      scale:  100,
      setTheme:  (theme)  => { applyTheme(theme, get().accent); set({ theme }) },
      setAccent: (accent) => { applyAccent(accent); set({ accent }) },
      setScale:  (scale)  => { applyScale(scale); set({ scale }) },
    }),
    {
      name: 'theme-preference',
      // version 2 (2026-09-29): Display size added; a version-1 state keeps
      // its theme and accent and starts at 100 %.
      // version 3 (2026-09-29): the Animations setting is gone (the full motion
      // set is always on); a saved `motion` field is dropped.
      version: 3,
      migrate: (persisted, version) => {
        const old = { ...((persisted ?? {}) as Partial<ThemeState> & { motion?: unknown }) }
        delete old.motion
        if (version >= 1) return { ...old, scale: resolveScale(old.scale) } as ThemeState
        try { localStorage.removeItem('accent-theme') } catch { /* private mode */ }
        return { theme: old.theme ?? 'system', accent: DEFAULT_ACCENT, scale: 100 } as ThemeState
      },
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.accent = resolveAccent(state.accent)
          state.scale = resolveScale(state.scale)
        }
      },
    }
  )
)

/** Applies the persisted theme + accent once on boot (the inline script only stamps .dark). */
export function applyStoredTheme() {
  const { theme, accent, scale } = useThemeStore.getState()
  applyTheme(theme, accent)
  applyScale(scale)
}

// The inline script only fires once, on load — this keeps the DOM in sync
// if the OS-level preference flips while the tab stays open (e.g. macOS's
// automatic light→dark at sunset) and the user hasn't overridden to an
// explicit light/dark choice.
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme, accent } = useThemeStore.getState()
    if (theme === 'system') applyTheme('system', accent)
  })
}
