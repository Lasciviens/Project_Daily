// The project detail's PageBoard layout (THEME.md §6.3). Pure data so
// scripts/verify-feature-boards.cjs can check every step.
//
//   1  phone, tablet — back, header, view controls, phases (or the board),
//      then notes and activity.
//   2  1280 / 1469 laptop — the work in main, notes + activity beside it.
//   3  1920 — the work spans main + one side track.
//   4  2450 — the work spans three tracks (phases three across); notes and
//      activity keep the last one.
// The phases are dealt into column stacks by index (phase i → column i mod
// N, PhaseColumns), never a row grid: a short phase beside a long one left a
// hole under it and "Add phase" floated mid-row. N follows the stack area's
// own width — two from 61rem, three from 92rem — so a phase card stays
// ≥ 30rem, which an item row needs before its title starts to cut off
// (1280 / 1469 → one column, 1920 → two, 2450 → three).
import type { BoardLayouts } from '../../shared/ui/pageBoardRules'

export const PROJECT_SECTIONS = ['back', 'header', 'controls', 'items', 'notes', 'activity'] as const
export type ProjectSection = typeof PROJECT_SECTIONS[number]

const WORK = ['header', 'controls', 'items'] as const
const SIDE = ['notes', 'activity'] as const

export const PROJECT_BOARD: BoardLayouts<ProjectSection> = {
  1: ['back', ...WORK, ...SIDE],
  2: { top: ['back'], columns: [WORK, SIDE] },
  3: { top: ['back'], columns: [{ stack: WORK, span: 2 }, SIDE] },
  4: { top: ['back'], columns: [{ stack: WORK, span: 3 }, SIDE] },
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
