// Wishes' PageBoard layout (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

//   1  phone, tablet — intro, quick add, filters, then the groups.
//   2+ the intro line on top; quick add + filters in a sticky rail on the
//      left; the groups take every other track, so their cards (15–18rem)
//      gain columns as the page widens instead of the list growing down.
export const WISH_SECTIONS = ['intro', 'add', 'filters', 'groups'] as const
export type WishSection = typeof WISH_SECTIONS[number]

const RAIL = { stack: ['add', 'filters'], sticky: true } as const

export const WISH_BOARD: BoardLayouts<WishSection> = {
  1: ['intro', 'add', 'filters', 'groups'],
  2: { top: ['intro'], lead: 1, columns: [RAIL, ['groups']] },
  3: { top: ['intro'], lead: 1, columns: [RAIL, { stack: ['groups'], span: 2 }] },
  4: { top: ['intro'], lead: 1, columns: [RAIL, { stack: ['groups'], span: 3 }] },
}
