// Media's PageBoard layout, one declaration per step (THEME.md §6.3). Pure
// data so scripts/verify-feature-boards.cjs can check that no step drops a
// section.
//
// One column at every width (owner, 05.10.2026): the search card with
// What to watch? beside the box, Continue watching, Coming soon (collapsed),
// then Discover across the whole page — the right-hand library/tools column
// is gone, so Discover gets that room for more and bigger posters.
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

export const MEDIA_SECTIONS = ['library', 'discovery'] as const
export type MediaSection = typeof MEDIA_SECTIONS[number]

const MAIN = ['library', 'discovery'] as const

export const MEDIA_BOARD: BoardLayouts<MediaSection> = {
  1: [...MAIN],
  2: { columns: [{ stack: MAIN, span: 2 }] },
  3: { columns: [{ stack: MAIN, span: 3 }] },
  4: { columns: [{ stack: MAIN, span: 4 }] },
}
