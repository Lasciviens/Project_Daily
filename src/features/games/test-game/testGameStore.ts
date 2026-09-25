import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  ALL_PLATFORMS, type TgSection, type TgSort, type TgStatusFilter, type TgView,
} from './testGameModel'

// UI state for the Test-Game page. Its own store (not the app's useUIStore)
// because the page is a self-contained experiment: nothing else in the app
// reads any of this, and removing the page must remove the state with it.
//
// Persisted: where you were (section, platform, view, sort, advanced tab) so a
// reload lands back on the same shelf. NOT persisted: the search text and
// transient panels — a stale search restored on reload reads as missing games.

export type AdvancedTab = 'classic' | 'tiers' | 'review' | 'scraper' | 'steam' | 'playstation' | 'queue' | 'tools'

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
  advancedTab: AdvancedTab

  setSection: (s: TgSection) => void
  setPlatform: (p: string) => void
  setScopePlatform: (p: string) => void
  setStatus: (s: TgStatusFilter) => void
  setGenre: (g: string | null) => void
  setSort: (s: TgSort) => void
  setView: (v: TgView) => void
  setSearch: (q: string) => void
  select: (id: string | null) => void
  setAdvancedTab: (t: AdvancedTab) => void
}

export const useTestGameStore = create<TgState>()(
  persist(
    (set) => ({
      section: 'library',
      platform: ALL_PLATFORMS,
      scopePlatform: ALL_PLATFORMS,
      status: 'all',
      genre: null,
      sort: 'title',
      view: 'shelf',
      search: '',
      selectedId: null,
      advancedTab: 'classic',

      // Changing section resets the per-section narrowing: a "Playing" tab
      // carried into Completed, or a platform chip carried into Wishlist,
      // would silently show an empty view.
      setSection: (section) => set({ section, status: 'all', scopePlatform: ALL_PLATFORMS }),
      setPlatform: (platform) => set({ platform, section: 'library', status: 'all' }),
      setScopePlatform: (scopePlatform) => set({ scopePlatform }),
      setStatus: (status) => set({ status }),
      setGenre: (genre) => set({ genre }),
      setSort: (sort) => set({ sort }),
      setView: (view) => set({ view }),
      setSearch: (search) => set({ search }),
      select: (selectedId) => set({ selectedId }),
      setAdvancedTab: (advancedTab) => set({ advancedTab, section: 'advanced' }),
    }),
    {
      name: 'test-game-ui-v1',
      partialize: (s) => ({
        section: s.section, platform: s.platform, sort: s.sort, view: s.view,
        advancedTab: s.advancedTab, selectedId: s.selectedId,
      }),
    },
  ),
)
