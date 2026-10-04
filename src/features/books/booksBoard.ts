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

// Reading (statistics)
//   1    today, the 30-day chart, books, time of day, the goal.
//   2    today + chart + time of day in main; books and the goal beside.
//   3    time of day moves to its own track (it can be empty: the last one).
//   4    the goal gets a track before it; the page stops there.
export const READING_SECTIONS = ['today', 'chart', 'books', 'hours', 'goal'] as const
export type ReadingSection = typeof READING_SECTIONS[number]

export const READING_BOARD: BoardLayouts<ReadingSection> = {
  1: ['today', 'chart', 'books', 'hours', 'goal'],
  2: { columns: [['today', 'chart', 'hours'], ['books', 'goal']] },
  3: { columns: [['today', 'chart'], ['books', 'goal'], ['hours']] },
  4: { columns: [['today', 'chart'], ['books'], ['goal'], ['hours']] },
}
