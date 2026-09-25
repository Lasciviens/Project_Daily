import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  ALL_PLATFORMS, type TgSection, type TgSort, type TgStatusFilter, type TgView,
} from './testGameModel'
import type { TgaLibrary, TgaWindow } from './components/tgAnalyticsModel'

// UI state for the Test-Game page. Its own store (not the app's useUIStore)
// because the page is a self-contained experiment: nothing else in the app
// reads any of this, and removing the page must remove the state with it.
//
// Persisted: where you were (section, platform, view, sort, advanced tab) and
// whether the detail overlay is tucked into its tab, so a reload lands back on
// the same shelf. NOT persisted: the search text, the selection and whether
// the details are open — a reload starts with nothing picked and nothing
// covering the games (a stale search restored on reload reads as missing games).

export type AdvancedTab = 'classic' | 'tiers' | 'review' | 'scraper' | 'steam' | 'playstation' | 'queue' | 'tools'

/**
 * What a click or Enter on a game did to the tablet/desktop detail overlay:
 * `opened` — it now shows that game expanded, because the user asked for it
 * (it was closed, it was tucked away showing that game, or it already showed
 * it); `swapped` — the open overlay moved to the new game; `tab` — the tucked
 * overlay's tab moved to the new game and stayed tucked.
 */
export type TgActivation = 'opened' | 'swapped' | 'tab'

interface TgState {
  section: TgSection
  platform: string
  /** Wishlist/Completed/Backlog views: one platform, or all. */
  scopePlatform: string
  status: TgStatusFilter
  genre: string | null
  sort: TgSort
  view: TgView
  search: string
  selectedId: string | null
  /** The selected game's details are showing (tablet/desktop overlay, phone sheet). */
  detailOpen: boolean
  /** The overlay is tucked into its slim tab at the right edge (tablet/desktop). */
  detailCollapsed: boolean
  advancedTab: AdvancedTab
  /** Analytics filters: kept here (not persisted) so a tablet↔phone switch,
   *  which remounts the view, doesn't reset them. */
  analyticsPeriod: TgaWindow
  analyticsLibrary: TgaLibrary

  setSection: (s: TgSection) => void
  setPlatform: (p: string) => void
  setScopePlatform: (p: string) => void
  setStatus: (s: TgStatusFilter) => void
  setGenre: (g: string | null) => void
  setSort: (s: TgSort) => void
  setView: (v: TgView) => void
  setSearch: (q: string) => void
  /** Moves the selection only (arrow keys): an open overlay follows, a closed one stays closed. */
  select: (id: string | null) => void
  /** Selects a game and shows its details expanded (the phone's tap, a restored sheet). */
  openDetail: (id: string) => void
  /** A click or Enter on a game at tablet/desktop width — see TgActivation. */
  activateGame: (id: string) => TgActivation
  closeDetail: () => void
  setDetailCollapsed: (collapsed: boolean) => void
  setAdvancedTab: (t: AdvancedTab) => void
  setAnalyticsPeriod: (p: TgaWindow) => void
  setAnalyticsLibrary: (l: TgaLibrary) => void
}

// Moving to another section or platform is navigation, not filtering: the
// open game belongs to the shelf being left, so its details close with it.
const LEAVE_SHELF = { selectedId: null, detailOpen: false } as const

export const useTestGameStore = create<TgState>()(
  persist(
    (set, get) => ({
      section: 'library',
      platform: ALL_PLATFORMS,
      scopePlatform: ALL_PLATFORMS,
      status: 'all',
      genre: null,
      sort: 'title',
      view: 'shelf',
      search: '',
      selectedId: null,
      detailOpen: false,
      detailCollapsed: false,
      advancedTab: 'classic',
      analyticsPeriod: 'all',
      analyticsLibrary: 'all',

      // Changing section resets the per-section narrowing: a "Playing" tab
      // carried into Completed, or a platform chip carried into Wishlist,
      // would silently show an empty view.
      setSection: (section) => set(s => ({
        section, status: 'all', scopePlatform: ALL_PLATFORMS, ...(s.section !== section && LEAVE_SHELF),
      })),
      setPlatform: (platform) => set(s => ({
        platform, section: 'library', status: 'all',
        ...((s.platform !== platform || s.section !== 'library') && LEAVE_SHELF),
      })),
      setScopePlatform: (scopePlatform) => set({ scopePlatform }),
      setStatus: (status) => set({ status }),
      setGenre: (genre) => set({ genre }),
      setSort: (sort) => set({ sort }),
      setView: (view) => set({ view }),
      setSearch: (search) => set({ search }),
      select: (selectedId) => set({ selectedId }),
      openDetail: (selectedId) => set({ selectedId, detailOpen: true, detailCollapsed: false }),
      activateGame: (id) => {
        const { detailOpen, detailCollapsed, selectedId } = get()
        // Closed, or tucked away showing this very game: open it expanded.
        if (!detailOpen || (detailCollapsed && selectedId === id)) {
          set({ selectedId: id, detailOpen: true, detailCollapsed: false })
          return 'opened'
        }
        if (selectedId === id) return 'opened'
        set({ selectedId: id })
        return detailCollapsed ? 'tab' : 'swapped'
      },
      closeDetail: () => set({ detailOpen: false }),
      setDetailCollapsed: (detailCollapsed) => set({ detailCollapsed }),
      setAnalyticsPeriod: (analyticsPeriod) => set({ analyticsPeriod }),
      setAnalyticsLibrary: (analyticsLibrary) => set({ analyticsLibrary }),
      setAdvancedTab: (advancedTab) => set(s => ({ advancedTab, section: 'advanced', ...(s.section !== 'advanced' && LEAVE_SHELF) })),
    }),
    {
      name: 'test-game-ui-v1',
      partialize: (s) => ({
        section: s.section, platform: s.platform, sort: s.sort, view: s.view,
        advancedTab: s.advancedTab, detailCollapsed: s.detailCollapsed,
      }),
      // Earlier versions persisted the selection; a reload must not bring it
      // (or open details) back.
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<TgState>), selectedId: null, detailOpen: false }),
    },
  ),
)
