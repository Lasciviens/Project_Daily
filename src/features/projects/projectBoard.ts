// The project page's PageBoard layout (THEME.md §6.3). Pure data so
// scripts/verify-feature-boards.cjs can check every step.
//
//   1  phone, tablet — back, the header, then the plan and every block in
//      the owner's order in one stack (the section chips jump to each).
//   2  1280 / 1469 laptop — the plan, text pages and wide tables in main;
//      the log, questions, links and narrow tables in the side track.
//   3  1920 — main spans two tracks (phases two across).
//   4  2450 — main spans three tracks (phases three across); the side
//      blocks keep the last one.
// The phases are dealt into column stacks by index (phase i → column i mod
// N, PhaseColumns), never a row grid: a short phase beside a long one left a
// hole under it. N follows the plan's own width — two from 61rem, three from
// 92rem — so a phase card stays ≥ 30rem, which a task row needs before its
// title starts to cut off (1280 / 1469 → one column, 1920 → two, 2450 → three).
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'
import type { BlockKind } from './types'

export const PROJECT_SECTIONS = ['back', 'header', 'main', 'side'] as const
export type ProjectSection = typeof PROJECT_SECTIONS[number]

export const PROJECT_BOARD: BoardLayouts<ProjectSection> = {
  1: ['back', 'header', 'main'],
  2: { top: ['back'], columns: [['header', 'main'], ['side']] },
  3: { top: ['back'], columns: [{ stack: ['header', 'main'], span: 2 }, ['side']] },
  4: { top: ['back'], columns: [{ stack: ['header', 'main'], span: 3 }, ['side']] },
}

/** The same page when no block goes to the side track (a project of text pages
 *  and wide tables, or none yet): main takes every track, so no column stands empty. */
export const PROJECT_BOARD_WIDE: BoardLayouts<ProjectSection> = {
  1: ['back', 'header', 'main'],
  2: { top: ['back'], columns: [{ stack: ['header', 'main'], span: 2 }] },
  3: { top: ['back'], columns: [{ stack: ['header', 'main'], span: 3 }] },
  4: { top: ['back'], columns: [{ stack: ['header', 'main'], span: 4 }] },
}

export function projectLayout(hasSideBlocks: boolean): BoardLayouts<ProjectSection> {
  return hasSideBlocks ? PROJECT_BOARD : PROJECT_BOARD_WIDE
}

/** Where a block sits from step 2: text pages and tables of more than three
 *  columns beside the plan; the log, questions, links and narrow tables in
 *  the side track. On a phone every block follows the plan in its own order. */
export function blockTrack(kind: BlockKind, columnCount = 0): 'main' | 'side' {
  return kind === 'pages' || (kind === 'table' && columnCount > 3) ? 'main' : 'side'
}

/** Stack-area widths (rem) from which the phases get two and three columns. */
export const PHASE_COLUMNS_FROM = [61, 92] as const

/** How many phase columns a stack area of this width (rem) holds. */
export function phaseColumnCount(widthRem: number): 1 | 2 | 3 {
  if (!Number.isFinite(widthRem)) return 1
  const [two, three] = PHASE_COLUMNS_FROM
  return widthRem >= three ? 3 : widthRem >= two ? 2 : 1
}

/**
 * Deal items into `columns` stacks by index (item i → stack i mod n), so an
 * item's column never depends on its neighbours' heights. Reading order is
 * across, then down; the next item to be added lands where it will appear.
 */
export function dealByIndex<T>(items: readonly T[], columns: number): T[][] {
  const n = Math.max(1, Math.floor(Number.isFinite(columns) ? columns : 1))
  const out: T[][] = Array.from({ length: n }, () => [])
  items.forEach((item, i) => out[i % n].push(item))
  return out
}

// ── The project list ───────────────────────────────────────────────────────
/** Project cards: auto-fill columns of 19–22rem with a 1rem gap (ProjectsPage). */
export const PROJECT_CARD = { max: 22, gap: 1 } as const

/**
 * How wide the list's header may get (rem) so New project ends over the last
 * card instead of past it: the cards the row actually holds (auto-fill counts
 * columns off the 22rem maximum) times 22rem, plus their gaps. Null when the
 * cards already fill the row (or there are none), i.e. no cap.
 */
export function projectsHeaderCapRem(cards: number, widthRem: number): number | null {
  if (!(cards > 0) || !(widthRem > 0)) return null
  const fit = Math.max(1, Math.floor((widthRem + PROJECT_CARD.gap) / (PROJECT_CARD.max + PROJECT_CARD.gap)))
  const used = Math.min(cards, fit)
  const cap = used * PROJECT_CARD.max + (used - 1) * PROJECT_CARD.gap
  return cap < widthRem ? cap : null
}
