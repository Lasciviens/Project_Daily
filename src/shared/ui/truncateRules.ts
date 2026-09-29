// Pure decisions behind <Truncate> (THEME.md §5). Import-free so
// scripts/verify-truncate-and-motion.cjs can check them without a browser.

export type TruncateLines = 1 | 2 | 3

/**
 * How the rest of a cut text is revealed:
 * - `auto`    — one line: a bubble; two or three lines: an in-place "More";
 * - `popover` / `more` — force one of the two;
 * - `none`    — only the title and the mouse tooltip (the caller shows the
 *               full text somewhere else).
 */
export type TruncateReveal = 'auto' | 'popover' | 'more' | 'none'

/** What the component ends up doing once it knows where it sits. */
export type RevealMode = 'popover' | 'more' | 'hover'

export interface BoxMetrics {
  scrollWidth: number
  clientWidth: number
  scrollHeight: number
  clientHeight: number
}

/** Sub-pixel layout rounding can leave scroll 1px over client on text that fits. */
const TOLERANCE_PX = 1

/**
 * Is the text actually cut? One line compares widths (`truncate`), a clamp
 * compares heights (`line-clamp-N`). A box with no size is not laid out
 * (display: none, a collapsed panel) and never counts as cut.
 */
export function isTextCut(m: BoxMetrics, lines: number): boolean {
  if (m.clientWidth <= 0 || m.clientHeight <= 0) return false
  return lines <= 1
    ? m.scrollWidth > m.clientWidth + TOLERANCE_PX
    : m.scrollHeight > m.clientHeight + TOLERANCE_PX
}

/**
 * Inside a tappable row (a button, a link, a role=button row) the text can't
 * become a control of its own — that would nest a button in a button — so it
 * only gets the mouse tooltip; on touch the row's own tap opens the item,
 * which shows the full text.
 */
export function revealModeFor(opts: { lines: number; reveal: TruncateReveal; insideTappable: boolean }): RevealMode {
  if (opts.insideTappable || opts.reveal === 'none') return 'hover'
  if (opts.reveal === 'popover' || opts.reveal === 'more') return opts.reveal
  return opts.lines >= 2 ? 'more' : 'popover'
}

/** Ancestors that already handle a tap: text inside them never becomes a trigger. */
export const TAPPABLE_SELECTOR = [
  'button', 'a[href]', 'label', 'summary', 'select',
  '[role="button"]', '[role="link"]', '[role="tab"]', '[role="option"]',
  '[role="menuitem"]', '[role="menuitemradio"]', '[role="menuitemcheckbox"]',
  '[role="checkbox"]', '[role="radio"]', '[role="switch"]',
].join(',')

/** The class that cuts the text: one line truncates, more lines clamp (and break long words). */
export function truncateClass(lines: number, expanded: boolean): string {
  if (expanded) return 'break-words'
  if (lines <= 1) return 'truncate'
  return lines === 2 ? 'line-clamp-2 break-words' : 'line-clamp-3 break-words'
}

/**
 * The bubble's z-index when its text sits inside a layer at or above the
 * popover layer (the floating request composer is z-float): one above that
 * layer, so the bubble never opens underneath it. `undefined` keeps the
 * bubble's own z-popover. `layerZ` is the z-index of the text's outermost
 * positioned ancestor that has one — where the text sits in the page's
 * stacking order.
 */
export function bubbleZIndex(layerZ: number | undefined, popoverZ: number): number | undefined {
  return layerZ != null && Number.isFinite(layerZ) && layerZ >= popoverZ ? layerZ + 1 : undefined
}
