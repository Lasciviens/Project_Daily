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
//      the middle (owner, 08.10.2026). There the tiles split — training,
//      watched, books and games in one row under the week and tasks, weather
//      and money under transit — so both columns end about together. A 1280px
//      laptop stacks the week and the tasks and keeps all six beside them.
//   3  1920 — full widgets: weather/transit/currency/games, then training,
//      media and books.
//   4  2450 — weather/transit/currency, training/media, books/games.
//   From step 2 up, news is a band across the bottom of the whole board
//   (owner, 07.10.2026): headlines side by side as cards, never a narrow
//   column. It is the last thing on the page and holds no actionable content,
//   so starting below the tallest column is what it is for.
import { BOARD, pageStepForWidth, resolveBoardLayout, type BoardLayouts, type PageStep } from '../../../shared/ui/pageBoardRules'

export const HOME_SECTIONS = [
  'brief', 'hero', 'tasks', 'pair', 'transit', 'tiles', 'news',
  'weather', 'currency', 'training', 'media', 'books', 'games',
  // The six tiles in two groups (the split laptop layout): what's outside
  // today (weather, money) and your own things (training, watched, books, games).
  'outsideTiles', 'activityTiles',
] as const
export type HomeSection = typeof HOME_SECTIONS[number]

const MAIN = ['brief', 'hero', 'tasks'] as const
/** From the laptop up the week and the tasks share one row (`pair` renders both). */
const WIDE_MAIN = ['brief', 'pair'] as const
/**
 * Home's main track may grow past the default 56rem: the brief, the week and
 * the tasks lay themselves out in two columns once wide (container queries),
 * so a 1795px laptop no longer ends in an empty strip right of the cards.
 */
const HOME_MAIN = '72rem'

export const HOME_BOARD: BoardLayouts<HomeSection> = {
  1: [...MAIN, 'transit', 'tiles', 'news'],
  2: { columns: [WIDE_MAIN, ['transit', 'tiles']], bottom: ['news'], main: HOME_MAIN },
  3: { columns: [WIDE_MAIN, ['weather', 'transit', 'currency', 'games'], ['training', 'media', 'books']], bottom: ['news'], main: HOME_MAIN },
  4: { columns: [WIDE_MAIN, ['weather', 'transit', 'currency'], ['training', 'media'], ['books', 'games']], bottom: ['news'], main: HOME_MAIN },
}

/** Step 2 once the week and the tasks sit side by side: the tiles split between the columns. */
export const HOME_BOARD_SPLIT: BoardLayouts<HomeSection> = {
  ...HOME_BOARD,
  2: { columns: [[...WIDE_MAIN, 'activityTiles'], ['transit', 'outsideTiles']], bottom: ['news'], main: HOME_MAIN },
}

/**
 * The main track's width from which `pair` lays the week and the tasks side by
 * side — HeroAndTasks' `@[44rem]` container query in HomePage.tsx (keep the
 * two equal; scripts/verify-page-board.cjs checks it).
 */
export const PAIR_SIDE_BY_SIDE_REM = 44

/**
 * Home's layout for its content width (rem; null before the first measure).
 * At step 2 the main track is the page minus one side track, up to 72rem; from
 * 44rem of it the split layout keeps the two columns about the same height.
 */
export function homeBoardFor(pageRem: number | null): BoardLayouts<HomeSection> {
  if (pageRem == null || pageStepForWidth(pageRem * 16) !== 2) return HOME_BOARD
  const main = Math.min(parseFloat(HOME_MAIN), pageRem - BOARD.side - BOARD.gap)
  return main >= PAIR_SIDE_BY_SIDE_REM ? HOME_BOARD_SPLIT : HOME_BOARD
}

/** What every step must show in some form: tiles stand in for the six glance widgets. */
export const HOME_GLANCE: Record<string, HomeSection[]> = {
  weather: ['weather', 'tiles', 'outsideTiles'], currency: ['currency', 'tiles', 'outsideTiles'],
  training: ['training', 'tiles', 'activityTiles'], media: ['media', 'tiles', 'activityTiles'],
  books: ['books', 'tiles', 'activityTiles'], games: ['games', 'tiles', 'activityTiles'],
}

/** The tile groups: a widget's tile is in `tiles` or in one of these. */
export const TILE_SECTIONS: readonly HomeSection[] = ['tiles', 'outsideTiles', 'activityTiles']

/** Headlines the news card lists: a list of 8 on a phone; about two rows of cards in the band. */
export const NEWS_ROWS: Record<PageStep, number> = { 1: 8, 2: 12, 3: 14, 4: 16 }

/** True where news is the full-width band under the columns (cards side by side). */
export function newsIsBand(step: PageStep): boolean {
  return resolveBoardLayout(HOME_BOARD, step).bottom.includes('news')
}

export function newsRows(step: PageStep): number {
  return NEWS_ROWS[step]
}
