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

//   1  the add box first (capture is the point), the list, the grocery
//      basket (it sums up the list above it), then buy again.
//   2+ add box, basket and buy-again chips in a sticky rail (the basket — a
//      few short lines — above the chips, which can run long); the stores'
//      lists take the rest and flow into columns by their own width.
export const QUICK_SECTIONS = ['add', 'basket', 'again', 'list'] as const
export type QuickSection = typeof QUICK_SECTIONS[number]

const QUICK_RAIL = { stack: ['add', 'basket', 'again'], sticky: true } as const

export const QUICK_BOARD: BoardLayouts<QuickSection> = {
  1: ['add', 'list', 'basket', 'again'],
  2: { lead: 1, columns: [QUICK_RAIL, ['list']] },
  3: { lead: 1, columns: [QUICK_RAIL, { stack: ['list'], span: 2 }] },
  4: { lead: 1, columns: [QUICK_RAIL, { stack: ['list'], span: 3 }] },
}

//   Owned → Things (migration 137)
//   The filter bar runs across the top at every width (owner, 08.10.2026: it
//   drives everything below, so it reads first).
//   1  phone, tablet — the filters, what you own, coming up, then the things.
//   2+ the summary and deadlines in a sticky rail on the left (they sum up the
//      list); the category groups take every other track.
export const OWNED_SECTIONS = ['filters', 'summary', 'coming', 'groups'] as const
export type OwnedSection = typeof OWNED_SECTIONS[number]

const OWNED_RAIL = { stack: ['summary', 'coming'], sticky: true } as const

export const OWNED_BOARD: BoardLayouts<OwnedSection> = {
  1: ['filters', 'summary', 'coming', 'groups'],
  2: { lead: 1, top: ['filters'], columns: [OWNED_RAIL, ['groups']] },
  3: { lead: 1, top: ['filters'], columns: [OWNED_RAIL, { stack: ['groups'], span: 2 }] },
  4: { lead: 1, top: ['filters'], columns: [OWNED_RAIL, { stack: ['groups'], span: 3 }] },
}

//   Owned → Stats
//   1  the tiles, money in and out, the timeline, then the rest.
//   2  the tiles across; money, timeline and chains in main; by category,
//      stores, value and resale beside them.
//   3  money and the timeline across main + one side (the timeline wants
//      width); the lists in the last track.
//   4  the same, with the lists in two tracks. Resale (only when things were
//      bought to sell) sits last in the last track, so an empty one is only
//      ever at the far right.
export const STATS_SECTIONS = ['tiles', 'money', 'timeline', 'chains', 'categories', 'stores', 'value', 'resale'] as const
export type StatsSection = typeof STATS_SECTIONS[number]

export const STATS_BOARD: BoardLayouts<StatsSection> = {
  1: ['tiles', 'money', 'timeline', 'categories', 'value', 'chains', 'stores', 'resale'],
  2: { top: ['tiles'], columns: [['money', 'timeline', 'chains'], ['categories', 'stores', 'value', 'resale']] },
  3: { top: ['tiles'], columns: [{ stack: ['money', 'timeline', 'chains'], span: 2 }, ['categories', 'stores', 'value', 'resale']] },
  4: { top: ['tiles'], columns: [{ stack: ['money', 'timeline'], span: 2 }, ['categories', 'stores'], ['chains', 'value', 'resale']] },
}
