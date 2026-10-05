// Books' PageBoard layouts (THEME.md §6.3). Pure data; checked by
// scripts/verify-life-boards.cjs.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

// Send to Kobo
//   1    phone, tablet — send, then the inbox, then how to set up the Kobo.
//   2+   send + inbox in main; the one-time setup beside it. The page stops at
//        two tracks: three short cards have nothing to fill a third or fourth
//        (the trailing tracks stay empty on 1920/2450, by design).
export const BOOK_SECTIONS = ['send', 'inbox', 'setup'] as const
export type BookSection = typeof BOOK_SECTIONS[number]

export const BOOK_BOARD: BoardLayouts<BookSection> = {
  1: ['send', 'inbox', 'setup'],
  2: { columns: [['send', 'inbox'], ['setup']] },
  3: { columns: [['send', 'inbox'], ['setup'], []] },
  4: { columns: [['send', 'inbox'], ['setup'], [], []] },
}

// Library
//   1    tools, reading now, up next, then every book.
//   2+   the books take main (and more tracks as the page widens, so the cover
//        grid gains columns); "Up next" — the reading queue, which can be
//        empty — sits in the last track.
export const LIBRARY_SECTIONS = ['tools', 'reading', 'queue', 'grid'] as const
export type LibrarySection = typeof LIBRARY_SECTIONS[number]
const BOOKS = ['tools', 'reading', 'grid'] as const

export const LIBRARY_BOARD: BoardLayouts<LibrarySection> = {
  1: ['tools', 'reading', 'queue', 'grid'],
  2: { columns: [BOOKS, ['queue']] },
  3: { columns: [{ stack: BOOKS, span: 2 }, ['queue']] },
  4: { columns: [{ stack: BOOKS, span: 3 }, ['queue']] },
}

// Library, any other view (want to read, authors, collections, categories,
// subjects, news): the tools on top and the view across every track — its own
// grid adds columns as the page widens.
export const LIBRARY_BROWSE_SECTIONS = ['tools', 'grid'] as const
export type LibraryBrowseSection = typeof LIBRARY_BROWSE_SECTIONS[number]

export const LIBRARY_BROWSE_BOARD: BoardLayouts<LibraryBrowseSection> = {
  1: ['tools', 'grid'],
  2: { top: ['tools'], columns: [{ stack: ['grid'], span: 2 }] },
  3: { top: ['tools'], columns: [{ stack: ['grid'], span: 3 }] },
  4: { top: ['tools'], columns: [{ stack: ['grid'], span: 4 }] },
}

// Stats (what you read, how much, how far)
//   1    the KPI tiles, books in hand, minutes per day, the reading log, the
//        window's books, the year, finished books, time of day, the goal.
//   2    tiles across the top; books in hand + chart + log in main; the
//        window's books, the year, finished books, time of day and the goal beside.
//   3    the window's books + finished books get their own track; the year,
//        time of day and the goal (which can be short) sit in the last.
//   4    the log moves out of main into its own track.
export const STATS_SECTIONS = ['kpis', 'current', 'chart', 'log', 'window', 'year', 'finished', 'hours', 'goal'] as const
export type StatsSection = typeof STATS_SECTIONS[number]

export const STATS_BOARD: BoardLayouts<StatsSection> = {
  1: ['kpis', 'current', 'chart', 'log', 'window', 'year', 'finished', 'hours', 'goal'],
  2: { top: ['kpis'], columns: [['current', 'chart', 'log'], ['window', 'year', 'finished', 'hours', 'goal']] },
  3: { top: ['kpis'], columns: [['current', 'chart', 'log'], ['window', 'finished'], ['year', 'hours', 'goal']] },
  4: { top: ['kpis'], columns: [['current', 'chart'], ['log'], ['window', 'finished'], ['year', 'hours', 'goal']] },
}

// Kobo (control the device from the app)
//   1    the sections as a pill row, then the open section.
//   2+   the sections as a sticky list on the left (it drives the page); the
//        open section takes every other track.
export const KOBO_SECTIONS = ['nav', 'content'] as const
export type KoboSection = typeof KOBO_SECTIONS[number]

export const KOBO_BOARD: BoardLayouts<KoboSection> = {
  1: ['nav', 'content'],
  2: { lead: 1, columns: [{ stack: ['nav'], sticky: true }, ['content']] },
  3: { lead: 1, columns: [{ stack: ['nav'], sticky: true }, { stack: ['content'], span: 2 }] },
  4: { lead: 1, columns: [{ stack: ['nav'], sticky: true }, { stack: ['content'], span: 3 }] },
}
