// The Football page's PageBoard layout (THEME.md §6.3). Pure data so
// scripts/verify-feature-boards.cjs can check every step.
//
//   1  phone, tablet — live, coming up, results, the tables, what is followed.
//   2  1280 / 1469 laptop — the matches in main; tables and Following beside.
//   3  1920 — results get a track of their own.
//   4  2450 — tables and Following each get one.
// "live" is empty when nothing is being played: it heads the main stack, so
// no track is ever left empty between two cards.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

export const FOOTBALL_SECTIONS = ['live', 'next', 'results', 'tables', 'following'] as const
export type FootballSection = typeof FOOTBALL_SECTIONS[number]

export const FOOTBALL_BOARD: BoardLayouts<FootballSection> = {
  1: ['live', 'next', 'results', 'tables', 'following'],
  2: { columns: [['live', 'next', 'results'], ['tables', 'following']] },
  3: { columns: [['live', 'next'], ['results'], ['tables', 'following']] },
  4: { columns: [['live', 'next'], ['results'], ['tables'], ['following']] },
}
