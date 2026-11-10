// Shop's PageBoard layouts, one per view (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

//   Wishlist (phase 2, approved 10.11.2026) — Owned's shape: the filter bar
//   across the top, the summary line inside `groups` right above the picture
//   tiles, and "Needs a look" in a sticky rail on the RIGHT (owner,
//   14.10.2026: where Owned had Coming up).
//   1  phone, tablet — Needs a look as ONE line (it opens a sheet; owner,
//      09.11.2026: the first screen is the things), the filters, the groups.
//      The line leads: the filters go away for an empty wishlist, and nothing
//      that stays may sit under them (a layout shift).
//   2+ the groups take every track but the last, so the tiles (10rem and up)
//      gain columns as the page widens; Needs a look is the last track.
export const WISHLIST_SECTIONS = ['look', 'filters', 'groups'] as const
export type WishlistSection = typeof WISHLIST_SECTIONS[number]

const LOOK_RAIL = { stack: ['look'], sticky: true } as const

export const WISHLIST_BOARD: BoardLayouts<WishlistSection> = {
  1: ['look', 'filters', 'groups'],
  2: { top: ['filters'], columns: [['groups'], LOOK_RAIL] },
  3: { top: ['filters'], columns: [{ stack: ['groups'], span: 2 }, LOOK_RAIL] },
  4: { top: ['filters'], columns: [{ stack: ['groups'], span: 3 }, LOOK_RAIL] },
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
//   drives everything below, so it reads first). The summary is one line
//   right above the things it sums up (owner, 09.11.2026: the "What I own"
//   card took the phone's first screen). Needs a look took Coming up's place
//   (10.11.2026), so a return window or complaint right is never listed twice.
//   1  phone, tablet — Needs a look as one line first (as on the Wishlist:
//      the filters come with the things, and nothing that stays may sit under
//      them), the filters, the summary line, the things.
//   2+ the summary line and the category groups first, taking every track
//      but the last; Needs a look in a sticky rail on the RIGHT (owner,
//      14.10.2026).
export const OWNED_SECTIONS = ['filters', 'summary', 'look', 'groups'] as const
export type OwnedSection = typeof OWNED_SECTIONS[number]

const OWNED_RAIL = { stack: ['look'], sticky: true } as const

export const OWNED_BOARD: BoardLayouts<OwnedSection> = {
  1: ['look', 'filters', 'summary', 'groups'],
  2: { top: ['filters'], columns: [['summary', 'groups'], OWNED_RAIL] },
  3: { top: ['filters'], columns: [{ stack: ['summary', 'groups'], span: 2 }, OWNED_RAIL] },
  4: { top: ['filters'], columns: [{ stack: ['summary', 'groups'], span: 3 }, OWNED_RAIL] },
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
