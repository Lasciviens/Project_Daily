// Shop's PageBoard layouts, one per view (THEME.md §6.3). Pure data so
// scripts/verify-life-boards.cjs can check every step.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

//   Wishlist (phase 2, approved 10.11.2026) — Owned's shape: the filter bar
//   across the top, the summary line inside `groups` right above the picture
//   tiles. "Needs a look" is not a section any more: it is one button in the
//   Shop page's header (owner, 23.11.2026), so the rail's room goes to the
//   tiles (10rem and up), which gain columns as the page widens.
export const WISHLIST_SECTIONS = ['filters', 'groups'] as const
export type WishlistSection = typeof WISHLIST_SECTIONS[number]

/**
 * The things use the page's whole width (owner, 23.11.2026: the list stopped 200px short of the header at 1795): main
 * has no 56rem cap here — the grid's main track takes what the page has, the side tracks stay 24rem, and the things
 * span them all, so the row stacks / tiles fill the width.
 */
const WIDE = '200rem'

export const WISHLIST_BOARD: BoardLayouts<WishlistSection> = {
  1: ['filters', 'groups'],
  2: { main: WIDE, top: ['filters'], columns: [{ stack: ['groups'], span: 2 }] },
  3: { main: WIDE, top: ['filters'], columns: [{ stack: ['groups'], span: 3 }] },
  4: { main: WIDE, top: ['filters'], columns: [{ stack: ['groups'], span: 4 }] },
}

//   1  the add box first (capture is the point), the list — led by Buy
//      again, what your own ticks say is due (step C, 10.11.2026: one compact
//      group right above the stores; inside `list`, so it takes the
//      skeleton's place instead of pushing the list) — the grocery basket (it
//      sums up the list above it), then what you bought before.
//   2+ add box, basket and bought-before chips in a sticky rail (the basket —
//      a few short lines — above the chips, which can run long); the list
//      takes the rest and flows into columns by its own width.
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
//   drives everything below, so it reads first). No summary line any more
//   (owner, 23.11.2026: a pointless extra line) and no rail: Needs a look is a
//   button in the Shop page's header, so the things take every track.
//   1  the filters, the things.
//   2+ the things across the whole board. A tapped row's record opens in the popup at every width (owner,
//      23.11.2026: one popup everywhere; the side pane is gone).
export const OWNED_SECTIONS = ['filters', 'groups'] as const
export type OwnedSection = typeof OWNED_SECTIONS[number]

export const OWNED_BOARD: BoardLayouts<OwnedSection> = {
  1: ['filters', 'groups'],
  2: { main: WIDE, top: ['filters'], columns: [{ stack: ['groups'], span: 2 }] },
  3: { main: WIDE, top: ['filters'], columns: [{ stack: ['groups'], span: 3 }] },
  4: { main: WIDE, top: ['filters'], columns: [{ stack: ['groups'], span: 4 }] },
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
//   Step C (10.11.2026) adds this year vs last (`compare`), need or just for
//   fun (`why`), saved by watching (`saved`), wish to purchase with the
//   impulse buys (`wait`) and value kept by category (`kept`); `stores` is the
//   store scorecard. From step 3 main no longer spans: the side tracks carry
//   the list cards, so no track runs far longer than the others.
export const STATS_SECTIONS = ['tiles', 'compare', 'money', 'timeline', 'chains', 'categories', 'stores', 'value', 'why', 'saved', 'wait', 'kept', 'resale'] as const
export type StatsSection = typeof STATS_SECTIONS[number]

export const STATS_BOARD: BoardLayouts<StatsSection> = {
  1: ['tiles', 'compare', 'money', 'saved', 'why', 'wait', 'timeline', 'categories', 'kept', 'value', 'chains', 'stores', 'resale'],
  2: { top: ['tiles'], columns: [['compare', 'money', 'timeline', 'chains', 'wait'], ['saved', 'why', 'categories', 'kept', 'stores', 'value', 'resale']] },
  3: { top: ['tiles'], columns: [['compare', 'money', 'timeline', 'chains'], ['saved', 'why', 'wait', 'kept'], ['categories', 'stores', 'value', 'resale']] },
  4: { top: ['tiles'], columns: [['compare', 'money', 'timeline', 'chains'], ['saved', 'why', 'wait'], ['categories', 'kept'], ['stores', 'value', 'resale']] },
}
