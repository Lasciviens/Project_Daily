// Drag-to-reorder for every ordered list — pure rules. Built for the Media
// Queue (PR #651), shared by every list the owner orders (owner, 25.11.2026:
// "Yes, all lists"). Checked by scripts/verify-drag-reorder.cjs.

/** `items` with the one at `from` moved to `to` (clamped); a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items]
  if (from < 0 || from >= out.length) return out
  const target = Math.max(0, Math.min(out.length - 1, to))
  const [it] = out.splice(from, 1)
  out.splice(target, 0, it)
  return out
}

/**
 * Where a dragged row lands: the place of the row it is over (the rows in
 * between shift by one). Null when it would stay where it is.
 */
export function dropTarget(from: number, over: number | null, count: number): number | null {
  if (over == null || over === from || from < 0 || from >= count || over < 0 || over >= count) return null
  return over
}

/**
 * While a row is dragged from `from` towards `to`: which way row `n` steps
 * aside to open the gap (-1 up, 1 down, 0 stays). The dragged row itself
 * follows the pointer (0 here).
 */
export function stepAside(n: number, from: number, to: number | null): -1 | 0 | 1 {
  if (to == null || n === from) return 0
  if (from < to && n > from && n <= to) return -1
  if (to < from && n >= to && n < from) return 1
  return 0
}

/**
 * The 0-based place a row shows while a row is dragged: the dragged one its
 * landing place, every other one the place it gets if the drop lands there.
 * `from` null = nothing is dragged.
 */
export function shownPlace(n: number, from: number | null, to: number | null): number {
  if (from == null) return n
  return n === from ? (to ?? n) : n + stepAside(n, from, to)
}

/** How far a dragged row may move: its top never above the list's top, its bottom never below the list's bottom. */
export function clampDragY(y: number, row: { top: number; bottom: number }, list: { top: number; bottom: number }): number {
  return Math.min(Math.max(y, list.top - row.top), list.bottom - row.bottom)
}

/** The keyboard way to move a row: Alt+↑ / Alt+↓ on any control in it. The new place, or null. */
export function keyMove(key: string, altKey: boolean, index: number, count: number): number | null {
  if (!altKey) return null
  const to = key === 'ArrowUp' ? index - 1 : key === 'ArrowDown' ? index + 1 : null
  return to == null || to < 0 || to >= count ? null : to
}
