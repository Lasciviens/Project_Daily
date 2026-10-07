// Shop's PageBoard layouts, one per view (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

//   1  phone, tablet — one stack: the totals, the filters, then the groups.
//   2+ totals + filters in a sticky rail on the left (they sum up and drive
//      the list); the category groups take every other track, so their cards
//      (17–21rem) gain columns as the page widens.
export const WISHLIST_SECTIONS = ['totals', 'filters', 'groups'] as const
export type WishlistSection = typeof WISHLIST_SECTIONS[number]

const WISH_RAIL = { stack: ['totals', 'filters'], sticky: true } as const

export const WISHLIST_BOARD: BoardLayouts<WishlistSection> = {
  1: ['totals', 'filters', 'groups'],
  2: { lead: 1, columns: [WISH_RAIL, ['groups']] },
  3: { lead: 1, columns: [WISH_RAIL, { stack: ['groups'], span: 2 }] },
  4: { lead: 1, columns: [WISH_RAIL, { stack: ['groups'], span: 3 }] },
}

//   1  the add box first (capture is the point), the list, then buy again.
//   2+ add box + buy-again chips in a sticky rail; the stores' lists take the
//      rest and flow into columns by their own width.
export const QUICK_SECTIONS = ['add', 'again', 'list'] as const
export type QuickSection = typeof QUICK_SECTIONS[number]

const QUICK_RAIL = { stack: ['add', 'again'], sticky: true } as const

export const QUICK_BOARD: BoardLayouts<QuickSection> = {
  1: ['add', 'list', 'again'],
  2: { lead: 1, columns: [QUICK_RAIL, ['list']] },
  3: { lead: 1, columns: [QUICK_RAIL, { stack: ['list'], span: 2 }] },
  4: { lead: 1, columns: [QUICK_RAIL, { stack: ['list'], span: 3 }] },
}

//   1  what was spent, then the purchases.
//   2+ the spend summary as a sticky rail; the purchases (dense rows in
//      20rem+ columns) take the rest.
export const BOUGHT_SECTIONS = ['spent', 'bought'] as const
export type BoughtSection = typeof BOUGHT_SECTIONS[number]

export const BOUGHT_BOARD: BoardLayouts<BoughtSection> = {
  1: ['spent', 'bought'],
  2: { lead: 1, columns: [{ stack: ['spent'], sticky: true }, ['bought']] },
  3: { lead: 1, columns: [{ stack: ['spent'], sticky: true }, { stack: ['bought'], span: 2 }] },
  4: { lead: 1, columns: [{ stack: ['spent'], sticky: true }, { stack: ['bought'], span: 3 }] },
}
