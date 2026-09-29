// Work's PageBoard layouts (THEME.md §6.3). Pure data so
// scripts/verify-feature-boards.cjs can check every step.
//
// Sections: `rail` (Today / Notes / This week / Pinned links) and the work
// itself, in one of two shapes — `work` (focus strip, overdue strip, toolbar
// and the board or list in one stack) or, where the list sits beside the
// rail, `head` (the strips and the toolbar) above `list` (the rows alone).
//
// Board view (the default):
//   1  phone, tablet — work, then the rail.
//   2  1280 / 1469 laptop — the board needs the full width for four readable
//      columns, so the rail stays a band underneath (four across).
//   3  1920 — the board spans main + one side track, the rail sits beside it.
//   4  2450 — the board spans three tracks (its columns grow to at most
//      28rem, never wider), the rail keeps the last one.
// List view: task rows past 56rem only add empty space, so the rows keep the
// main track and the rail sits beside them from the laptop up (from 1920 it
// spans two tracks, its four cards two by two). The strips and the toolbar
// span the whole board above both — in the 56rem track the toolbar wrapped
// onto a second line and a focus card was cut off. The list stops at three
// tracks and never offers "Hide side panel": hiding the rail would only
// leave the rows alone beside an empty band.
//
// "Hide side panel" (Board view, only where the rail sits beside the work)
// gives its track back to the board.
import { boardWidthRem, type BoardLayouts, type PageStep } from '../../shared/ui/pageBoardRules'

export const WORK_SECTIONS = ['work', 'head', 'list', 'rail'] as const
export type WorkSection = typeof WORK_SECTIONS[number]
export type WorkView = 'board' | 'list'

const STACKED = ['work', 'rail'] as const

export const WORK_BOARD: BoardLayouts<WorkSection> = {
  1: STACKED,
  2: { columns: [{ stack: STACKED, span: 2 }] },
  3: { columns: [{ stack: ['work'], span: 2 }, ['rail']] },
  4: { columns: [{ stack: ['work'], span: 3 }, ['rail']] },
}
export const WORK_BOARD_RAIL_HIDDEN: BoardLayouts<WorkSection> = {
  1: STACKED,
  2: WORK_BOARD[2],
  3: { columns: [{ stack: ['work'], span: 3 }] },
  4: { columns: [{ stack: ['work'], span: 4 }] },
}
export const WORK_LIST: BoardLayouts<WorkSection> = {
  1: STACKED,
  2: { top: ['head'], columns: [['list'], ['rail']] },
  3: { top: ['head'], columns: [['list'], { stack: ['rail'], span: 2 }] },
}

/** The first step at which "Hide side panel" is offered, or null for a view that never offers it. */
export function railToggleFrom(view: WorkView): PageStep | null {
  return view === 'list' ? null : 3
}

export function workLayout(view: WorkView, railOpen: boolean): BoardLayouts<WorkSection> {
  if (view === 'list') return WORK_LIST
  return railOpen ? WORK_BOARD : WORK_BOARD_RAIL_HIDDEN
}

/**
 * The widest the page header may get (rem) so its right-hand controls end
 * where the board's last card ends — the list stops at three tracks, and New
 * task floated 25rem past the rail at 2450. Null: no cap (one track).
 */
export function workHeaderCapRem(view: WorkView, railOpen: boolean, step: PageStep): number | null {
  return boardWidthRem(workLayout(view, railOpen), step)
}
