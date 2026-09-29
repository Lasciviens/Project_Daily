// Pure pieces of <PageBoard> (THEME.md §6.3): which step a page's own width is
// at, which declared layout a step uses, and the grid template it renders.
// Import-free so scripts/verify-page-board.cjs can check them.
//
// The model: a page fills width by ADDING columns, never by stretching cards.
// Every step has one main track (≤ 56rem by default) and 0–3 side tracks of
// 24rem. Each column is a stack of sections; a column may span several tracks
// (a wide item), and full-width bands can sit above or below the columns.

export type PageStep = 1 | 2 | 3 | 4

/** Track sizes and step thresholds, in rem. */
export const BOARD = {
  /** Main track maximum (a page may lower it per layout). */
  main: 56,
  /** Side track width. */
  side: 24,
  /** Gap between tracks and between stacked sections. */
  gap: 1,
  /**
   * Page content widths where steps 2, 3 and 4 start. Step 2 needs a main
   * track of at least 35rem beside one side track (60 = 35 + 1 + 24): a
   * 1280px laptop (61.5rem of content) already gets two columns.
   */
  steps: [60, 100, 128] as const,
} as const

/** The widest board: main + three side tracks + their gaps (131rem). */
export const BOARD_MAX_REM = BOARD.main + 3 * BOARD.side + 3 * BOARD.gap

/**
 * The step for a page content width in px. Below 60rem one column (phones,
 * tablets); 60–100rem main + 1 side (1280 and 1469px laptops); 100–128rem
 * main + 2 sides (1920px); 128rem and up main + 3 sides (2450px).
 */
export function pageStepForWidth(px: number, remPx = 16): PageStep {
  if (!Number.isFinite(px) || px <= 0) return 1
  const rem = px / (remPx > 0 ? remPx : 16)
  const [two, three, four] = BOARD.steps
  if (rem >= four) return 4
  if (rem >= three) return 3
  if (rem >= two) return 2
  return 1
}

/** A column: a stack of section keys, optionally spanning several tracks. */
export interface BoardColumn<K extends string> {
  stack: readonly K[]
  /** Tracks this column covers (default 1). */
  span?: number
  /** Stick to the top while the page scrolls — only while the column fits the viewport (PageBoard checks; a taller one scrolls with the page). */
  sticky?: boolean
}

export type BoardColumnSpec<K extends string> = readonly K[] | BoardColumn<K>

/**
 * A layout for one step. A step-N layout has exactly N tracks: its columns'
 * spans add up to N (or it has no columns, only bands).
 */
export interface BoardLayout<K extends string> {
  /** Full-width stack above the columns. */
  top?: readonly K[]
  columns?: readonly BoardColumnSpec<K>[]
  /** Full-width stack below the columns. */
  bottom?: readonly K[]
  /** Main track maximum for this step (CSS length), e.g. '40rem' for a calendar. */
  main?: string
  /**
   * Side tracks placed BEFORE the main track (default 0). A rail that drives
   * or sums up the main column — a month calendar beside its workouts, a
   * day's totals beside its meals, an add form beside its list — reads first,
   * on the left. The columns still list tracks left to right.
   */
  lead?: number
}

/** Step 1 is always one stack; wider steps are optional (a missing step uses the nearest one below). */
export type BoardLayouts<K extends string> = { 1: readonly K[] } & Partial<Record<2 | 3 | 4, BoardLayout<K>>>

export interface ResolvedColumn<K extends string> { stack: readonly K[]; span: number; sticky: boolean }
export interface ResolvedLayout<K extends string> {
  /** The declared step this layout came from (= its track count). */
  tracks: PageStep
  top: readonly K[]
  columns: ResolvedColumn<K>[]
  bottom: readonly K[]
  main: string
  /** Side tracks before the main track. */
  lead: number
}

function isColumn<K extends string>(c: BoardColumnSpec<K>): c is BoardColumn<K> {
  return !Array.isArray(c)
}

function normalizeColumn<K extends string>(c: BoardColumnSpec<K>): ResolvedColumn<K> {
  if (isColumn(c)) return { stack: c.stack, span: Math.max(1, Math.floor(c.span ?? 1)), sticky: !!c.sticky }
  return { stack: c as readonly K[], span: 1, sticky: false }
}

/** The layout a step renders: the declared one, else the nearest declared step below it. */
export function resolveBoardLayout<K extends string>(layouts: BoardLayouts<K>, step: PageStep): ResolvedLayout<K> {
  for (let s = step; s >= 2; s--) {
    const l = layouts[s as 2 | 3 | 4]
    if (l) {
      return {
        tracks: s as PageStep,
        top: l.top ?? [],
        columns: (l.columns ?? []).map(normalizeColumn),
        bottom: l.bottom ?? [],
        main: l.main ?? `${BOARD.main}rem`,
        lead: Math.min(s - 1, Math.max(0, Math.floor(l.lead ?? 0))),
      }
    }
  }
  return { tracks: 1, top: [], columns: [{ stack: layouts[1], span: 1, sticky: false }], bottom: [], main: `${BOARD.main}rem`, lead: 0 }
}

/**
 * `grid-template-columns` for a resolved layout with 2+ tracks. Side tracks
 * are FIXED at 24rem (the step thresholds guarantee the room) and main takes
 * what is left up to its cap. Fixed sides also keep Chrome from sizing the
 * tracks off an item that spans several of them: with `minmax(0,24rem)` sides
 * and a column spanning three, main stopped at an equal share (512px of 896).
 */
export function boardTemplate(tracks: number, main = `${BOARD.main}rem`, lead = 0): string {
  if (tracks <= 1) return 'minmax(0,1fr)'
  const before = Math.min(tracks - 1, Math.max(0, Math.floor(lead)))
  if (before === 0) return `minmax(0,${main}) repeat(${tracks - 1},${BOARD.side}rem)`
  const after = tracks - 1 - before
  return `repeat(${before},${BOARD.side}rem) minmax(0,${main})${after > 0 ? ` repeat(${after},${BOARD.side}rem)` : ''}`
}

/** Every section key a step places, in reading order. */
export function keysAt<K extends string>(layouts: BoardLayouts<K>, step: PageStep): K[] {
  const l = resolveBoardLayout(layouts, step)
  return [...l.top, ...l.columns.flatMap(c => c.stack), ...l.bottom]
}

/**
 * Developer checks (run by the verify script): step 1 is declared; every
 * declared step fills exactly its tracks; no section is placed twice in one
 * step; every key is a known section. Returns the problems found.
 */
export function validateBoardLayouts<K extends string>(layouts: BoardLayouts<K>, known?: readonly K[]): string[] {
  const problems: string[] = []
  if (!Array.isArray(layouts[1]) || layouts[1].length === 0) problems.push('step 1 must be a non-empty stack')
  for (const s of [1, 2, 3, 4] as const) {
    if (s !== 1 && !layouts[s]) continue
    if (s !== 1) {
      const l = layouts[s]!
      const cols = (l.columns ?? []).map(normalizeColumn)
      const used = cols.reduce((a, c) => a + c.span, 0)
      if (cols.length > 0 && used !== s) problems.push(`step ${s}: columns cover ${used} tracks, expected ${s}`)
      if (cols.length === 0 && !(l.top?.length || l.bottom?.length)) problems.push(`step ${s}: nothing placed`)
      if (l.lead != null && (!Number.isInteger(l.lead) || l.lead < 0 || l.lead > s - 1)) problems.push(`step ${s}: lead ${l.lead} must be 0–${s - 1}`)
    }
    const keys = keysAt(layouts, s)
    const seen = new Set<string>()
    for (const k of keys) {
      if (seen.has(k)) problems.push(`step ${s}: "${k}" placed twice`)
      seen.add(k)
      if (known && !known.includes(k)) problems.push(`step ${s}: unknown section "${k}"`)
    }
  }
  return problems
}

/** Width a column of `span` tracks gets at a page content width (px), for audits and tests. */
export function columnWidthPx(pageWidth: number, layout: Pick<ResolvedLayout<string>, 'tracks' | 'main'> & { lead?: number }, index: number, span: number, remPx = 16): number {
  const gap = BOARD.gap * remPx
  const side = BOARD.side * remPx
  const mainMax = /^([\d.]+)rem$/.exec(layout.main) ? parseFloat(layout.main) * remPx : BOARD.main * remPx
  if (layout.tracks <= 1) return pageWidth
  // Sides stay at 24rem (the steps guarantee room); main takes the rest up to its cap.
  const mainW = Math.min(mainMax, pageWidth - (layout.tracks - 1) * (side + gap))
  const sides = (n: number) => Array.from({ length: n }, () => side)
  const lead = Math.min(layout.tracks - 1, Math.max(0, Math.floor(layout.lead ?? 0)))
  const widths = [...sides(lead), mainW, ...sides(layout.tracks - 1 - lead)]
  const covered = widths.slice(index, index + span)
  return covered.reduce((a, w) => a + w, 0) + (covered.length - 1) * gap
}

/**
 * The widest a board gets at a step, in rem: its main cap plus the side
 * tracks and gaps. Null on a one-track step (the stack takes the page width)
 * or when the main cap is not in rem. A page header above a board that stops
 * short of the container (a 40rem picker track) caps itself to this, so its
 * right-hand controls line up with the board's last card instead of floating
 * past it.
 */
export function boardWidthRem<K extends string>(layouts: BoardLayouts<K>, step: PageStep): number | null {
  const l = resolveBoardLayout(layouts, step)
  if (l.tracks <= 1) return null
  const m = /^([\d.]+)rem$/.exec(l.main)
  if (!m) return null
  return parseFloat(m[1]) + (l.tracks - 1) * (BOARD.side + BOARD.gap)
}
