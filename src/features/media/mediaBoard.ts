// Media's PageBoard layout, one declaration per step (THEME.md §6.3). Pure
// data so scripts/verify-feature-boards.cjs can check that no step drops a
// section.
//
//   1  phone, tablet — search + library, Discover, then the three tools as one
//      grid (one column on a phone, two once the grid is 36rem wide).
//   2  1280 / 1469 laptop — the same two cards in main; the tools in a sticky
//      side column (as before the board).
//   3  1920 — search + library and Discover span main + one side track (more
//      poster columns, never wider posters); the tools stay in the last one.
//   4  2450 — the tools get two columns and open by default, so their
//      content fills the space instead of three closed bars.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

export const MEDIA_SECTIONS = ['library', 'discovery', 'tools', 'tonight', 'calendar', 'stats'] as const
export type MediaSection = typeof MEDIA_SECTIONS[number]

const MAIN = ['library', 'discovery'] as const
const TOOLS = ['tonight', 'calendar', 'stats'] as const

export const MEDIA_BOARD: BoardLayouts<MediaSection> = {
  1: [...MAIN, 'tools'],
  2: { columns: [MAIN, { stack: TOOLS, sticky: true }] },
  3: { columns: [{ stack: MAIN, span: 2 }, { stack: TOOLS, sticky: true }] },
  4: { columns: [{ stack: MAIN, span: 2 }, ['tonight', 'calendar'], ['stats']] },
}

/** The step from which the Coming soon / Your stats cards start open (each has room of its own). */
export const MEDIA_TOOLS_OPEN_FROM = 4
