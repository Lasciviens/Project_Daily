// Books' PageBoard layout (THEME.md §6.3). Pure data.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

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
