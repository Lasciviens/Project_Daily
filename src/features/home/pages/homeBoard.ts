// Home's PageBoard layout, one declaration per step (THEME.md §6.3). Pure data
// so scripts/verify-page-board.cjs can check that no step drops a section.
//
//   1  phone, tablet — the actionable column (brief → now/next → tasks →
//      transit), glance tiles that open their detail, then news.
//   2  1280 / 1469 / 1795 laptop — the brief in main, then the week and the
//      tasks side by side under it (`pair`, owner 07.10.2026: rows beside each
//      other so main is no taller than transit and the tiles); transit and
//      the tiles beside them (the owner's call: compact tiles on the laptop;
//      each tile opens its widget's content in a popup — TileDetail.tsx).
//      Once main is wide enough for the week and the tasks to sit side by
//      side (`homeBoardFor`), main became ~600px tall against ~1,150px of
//      transit + six tiles, and news could only start under that: a hole in
//      the middle (owner, 08.10.2026). There the board lays out in ROWS whose
//      cards share a top and a bottom (owner, 16.10.2026: "Ends where the
//      other ends, starts where the other one starts"): brief | transit, then
//      week | tasks | a large weather tile; then one glance row on the same
//      tracks — money, watched, books and games under the week and the tasks,
//      a large training tile under the weather (owner, 14.10.2026). A 1280px
//      laptop stacks the week and the tasks and keeps all six tiles beside
//      them.
//   3  1920 — full widgets: weather/transit/currency/games, then training,
//      media and books.
//   4  2450 — weather/transit/currency, training/media, books/games.
//   From step 2 up, news is a band across the bottom of the whole board
//   (owner, 07.10.2026): headlines side by side as cards, never a narrow
//   column. It is the last thing on the page and holds no actionable content,
//   so starting below the tallest column is what it is for.
import { BOARD, boardTemplate, pageStepForWidth, resolveBoardLayout, type BoardLayouts, type PageStep } from '../../../shared/ui/pageBoardRules'

export const HOME_SECTIONS = [
  'brief', 'tasks', 'pair', 'transit', 'tiles', 'news',
  'weather', 'currency', 'training', 'media', 'books', 'games',
  // The split laptop layout's tiles: a large weather tile under transit, and
  // the glance row (money, watched, books, games | a large training tile).
  'weatherTile', 'glanceRow',
] as const
export type HomeSection = typeof HOME_SECTIONS[number]

// The week and the day are one card (HomeDayCard, owner 31.10.2026: one list of the day).
const MAIN = ['brief', 'tasks'] as const
/** From the laptop up the day card sits in the board's second row (`pair`). */
const WIDE_MAIN = ['brief', 'pair'] as const
/**
 * Home's main track may grow past the default 56rem: the brief and the day's
 * list lay themselves out in two columns once wide (container queries), so a
 * 1795px laptop no longer ends in an empty strip right of the cards.
 */
const HOME_MAIN = '72rem'

export const HOME_BOARD: BoardLayouts<HomeSection> = {
  1: [...MAIN, 'transit', 'tiles', 'news'],
  2: { columns: [WIDE_MAIN, ['transit', 'tiles']], bottom: ['news'], main: HOME_MAIN },
  3: { columns: [WIDE_MAIN, ['weather', 'transit', 'currency', 'games'], ['training', 'media', 'books']], bottom: ['news'], main: HOME_MAIN },
  4: { columns: [WIDE_MAIN, ['weather', 'transit', 'currency'], ['training', 'media'], ['books', 'games']], bottom: ['news'], main: HOME_MAIN },
}

/**
 * Step 2 once the main track is 44rem wide: board rows, so cards line up
 * through the grid, never through their content heights. Row 1 the brief |
 * transit, row 2 the day card (`pair`) | the large weather tile: each card
 * stretches to its row's tallest. As two column stacks
 * (brief → pair | transit → weather) they lined up only when transit happened
 * to be as tall as the brief (owner, 16.10.2026). Then the glance row on the
 * same tracks, then news.
 */
export const HOME_BOARD_SPLIT: BoardLayouts<HomeSection> = {
  ...HOME_BOARD,
  2: {
    rows: [
      [['brief'], ['transit']],
      [['pair'], ['weatherTile']],
    ],
    bottom: ['glanceRow', 'news'],
    main: HOME_MAIN,
  },
}

/**
 * The glance row's tracks: the split board's own (main + one side track), so
 * money · watched · books · games sit under the day card and the training
 * tile under transit and weather, edge to edge.
 */
export const GLANCE_ROW_TEMPLATE = boardTemplate(2, HOME_MAIN)

/**
 * The main track's width from which Home uses the split board (the day card
 * beside the large weather tile, in rows); the day's list lays its own columns
 * out from its own width (DayAgenda's container query).
 */
export const PAIR_SIDE_BY_SIDE_REM = 44

/**
 * Home's layout for its content width (rem; null before the first measure).
 * At step 2 the main track is the page minus one side track, up to 72rem; from
 * 44rem of it the split layout lines the day card up with the weather tile.
 */
export function homeBoardFor(pageRem: number | null): BoardLayouts<HomeSection> {
  if (pageRem == null || pageStepForWidth(pageRem * 16) !== 2) return HOME_BOARD
  const main = Math.min(parseFloat(HOME_MAIN), pageRem - BOARD.side - BOARD.gap)
  return main >= PAIR_SIDE_BY_SIDE_REM ? HOME_BOARD_SPLIT : HOME_BOARD
}

/** What every step must show in some form: tiles stand in for the six glance widgets. */
export const HOME_GLANCE: Record<string, HomeSection[]> = {
  weather: ['weather', 'tiles', 'weatherTile'], currency: ['currency', 'tiles', 'glanceRow'],
  training: ['training', 'tiles', 'glanceRow'], media: ['media', 'tiles', 'glanceRow'],
  books: ['books', 'tiles', 'glanceRow'], games: ['games', 'tiles', 'glanceRow'],
}

/** The tile sections: a widget's tile is in `tiles` or in one of these. */
export const TILE_SECTIONS: readonly HomeSection[] = ['tiles', 'weatherTile', 'glanceRow']

export type GlanceGroup = 'all' | 'row'

/**
 * Each tile group's grid (HomePage.tsx; container queries on the group's own
 * width). `all` (the six, phone and 1280 side column): 2 across, 3 on a wider
 * stack. `row` (money, watched, books, games on the glance row's main track):
 * 4 across with the board's own 1rem gap, so the tiles' edges line up with
 * the week's and the tasks' above them.
 */
export const GLANCE_GROUP_GRID: Record<GlanceGroup, string> = {
  all: 'gap-3 grid-cols-2 @[36rem]:grid-cols-3',
  row: 'gap-4 grid-cols-2 @[40rem]:grid-cols-4',
}

/** Headlines the news card lists: a list of 8 on a phone; about two rows of cards in the band. */
export const NEWS_ROWS: Record<PageStep, number> = { 1: 8, 2: 12, 3: 14, 4: 16 }

/** True where news is the full-width band under the columns (cards side by side). */
export function newsIsBand(step: PageStep): boolean {
  return resolveBoardLayout(HOME_BOARD, step).bottom.includes('news')
}

export function newsRows(step: PageStep): number {
  return NEWS_ROWS[step]
}
