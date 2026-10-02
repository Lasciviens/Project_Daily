// Media's PageBoard layout, one declaration per step (THEME.md §6.3). Pure
// data so scripts/verify-feature-boards.cjs can check that no step drops a
// section.
//
//   1  phone, tablet — search, your library, Discover, then the two tools as
//      one grid (one column on a phone, two once the grid is 36rem wide).
//   2  1280 / 1469 laptop — search and Discover in main; your library and the
//      tools in a sticky column on the right (owner, 02.10.2026).
//   3  1920 — search and Discover span main + one side track (more poster
//      columns, never wider posters); library and tools stay in the last one.
//   4  2450 — the library gets a column of its own, the tools the last one,
//      open by default.
// The stats moved to the Stats view (owner, 02.10.2026) — no card here.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

export const MEDIA_SECTIONS = ['library', 'summary', 'discovery', 'tools', 'tonight', 'calendar'] as const
export type MediaSection = typeof MEDIA_SECTIONS[number]

const MAIN = ['library', 'discovery'] as const
const TOOLS = ['tonight', 'calendar'] as const

export const MEDIA_BOARD: BoardLayouts<MediaSection> = {
  1: ['library', 'summary', 'discovery', 'tools'],
  2: { columns: [MAIN, { stack: ['summary', ...TOOLS], sticky: true }] },
  3: { columns: [{ stack: MAIN, span: 2 }, { stack: ['summary', ...TOOLS], sticky: true }] },
  4: { columns: [{ stack: MAIN, span: 2 }, ['summary'], ['tonight', 'calendar']] },
}

/** The step from which the Coming soon card starts open (it has room of its own). */
export const MEDIA_TOOLS_OPEN_FROM = 4
