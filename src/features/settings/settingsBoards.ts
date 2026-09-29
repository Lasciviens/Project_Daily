// Settings' PageBoard layouts (THEME.md §6.3). Pure and import-free.
// Subscriptions reuses CONNECTIONS_BOARD (developerBoards.ts).
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

// ── Places ───────────────────────────────────────────────────────────────
// Three bounded cards (Home, Work, Travel profile), so the page stops early:
//   1  phone, tablet — one 42rem-capped list.
//   2  laptop — Home + Work in a 42rem main, the travel profile beside them.
//   3  1920 and up — one card per track (main 28rem); 2450 leaves the last
//      track empty (nothing to put there).
export type PlacesSection = 'home' | 'work' | 'travel'
export const PLACES_BOARD: BoardLayouts<PlacesSection> = {
  1: ['home', 'work', 'travel'],
  2: { main: '42rem', columns: [['home', 'work'], ['travel']] },
  3: { main: '28rem', columns: [['home'], ['work'], ['travel']] },
}

// ── Appearance ───────────────────────────────────────────────────────────
// Two bounded cards: the look (theme, accent, animations, display size) and
// notifications. From the laptop they sit side by side; wider pages stop there.
export type AppearanceSection = 'look' | 'notifications'
export const APPEARANCE_BOARD: BoardLayouts<AppearanceSection> = {
  1: ['look', 'notifications'],
  2: { main: '42rem', columns: [['look'], ['notifications']] },
}

// ── APIs ─────────────────────────────────────────────────────────────────
// One collection (every external API, apiRegistry.ts) under a filter bar.
// The list spans every track and flows its 19–22rem cards into as many
// columns as fit (THEME W2); at most part of one card's width stays empty
// at the right.
export type ApisSection = 'toolbar' | 'list'
export const APIS_BOARD: BoardLayouts<ApisSection> = {
  1: ['toolbar', 'list'],
  2: { top: ['toolbar'], columns: [{ stack: ['list'], span: 2 }] },
  3: { top: ['toolbar'], columns: [{ stack: ['list'], span: 3 }] },
  4: { top: ['toolbar'], columns: [{ stack: ['list'], span: 4 }] },
}
