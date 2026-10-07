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
//   3  1920 — full widgets: weather/transit/currency/games, then training,
//      media and books.
//   4  2450 — weather/transit/currency, training/media, books/games.
//   From step 2 up, news is a band across the bottom of the whole board
//   (owner, 07.10.2026): headlines side by side as cards, never a narrow
//   column. It is the last thing on the page and holds no actionable content,
//   so starting below the tallest column is what it is for.
import { resolveBoardLayout, type BoardLayouts, type PageStep } from '../../../shared/ui/pageBoardRules'

export const HOME_SECTIONS = [
  'brief', 'hero', 'tasks', 'pair', 'transit', 'tiles', 'news',
  'weather', 'currency', 'training', 'media', 'books', 'games',
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

/** What every step must show in some form: tiles stand in for the six glance widgets. */
export const HOME_GLANCE: Record<string, HomeSection[]> = {
  weather: ['weather', 'tiles'], currency: ['currency', 'tiles'], training: ['training', 'tiles'],
  media: ['media', 'tiles'], books: ['books', 'tiles'], games: ['games', 'tiles'],
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
