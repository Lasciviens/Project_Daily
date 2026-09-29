// Home's PageBoard layout, one declaration per step (THEME.md §6.3). Pure data
// so scripts/verify-page-board.cjs can check that no step drops a section.
//
//   1  phone, tablet — the actionable column (brief → now/next → tasks →
//      transit), glance tiles that open their detail, then news.
//   2  1280 / 1469 laptop — the same three cards in main; transit, the tiles
//      and news beside them (the owner's call: compact tiles on the laptop).
//   3  1920 — full widgets: weather/transit/currency, then the page cards.
//   4  2450 — news gets a column of its own.
import type { BoardLayouts } from '../../../shared/ui/pageBoardRules'

export const HOME_SECTIONS = [
  'brief', 'hero', 'tasks', 'transit', 'tiles', 'news',
  'weather', 'currency', 'training', 'media', 'projects', 'games',
] as const
export type HomeSection = typeof HOME_SECTIONS[number]

const MAIN = ['brief', 'hero', 'tasks'] as const

export const HOME_BOARD: BoardLayouts<HomeSection> = {
  1: [...MAIN, 'transit', 'tiles', 'news'],
  2: { columns: [MAIN, ['transit', 'tiles', 'news']] },
  3: { columns: [MAIN, ['weather', 'transit', 'currency'], ['training', 'media', 'projects', 'games', 'news']] },
  4: { columns: [MAIN, ['weather', 'transit', 'currency'], ['training', 'media', 'projects', 'games'], ['news']] },
}

/** What every step must show in some form: tiles stand in for the six glance widgets. */
export const HOME_GLANCE: Record<string, HomeSection[]> = {
  weather: ['weather', 'tiles'], currency: ['currency', 'tiles'], training: ['training', 'tiles'],
  media: ['media', 'tiles'], projects: ['projects', 'tiles'], games: ['games', 'tiles'],
}
