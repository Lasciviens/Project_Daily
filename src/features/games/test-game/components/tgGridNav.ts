// Arrow-key moves over a list laid out in rows of `cols` (the bookcase, the
// cover grid, and the list view with one column). Pure, so the rules are
// verified in scripts/verify-test-game-model.cjs.

/**
 * The index an arrow key moves to from `cur`, or null for any other key.
 * Left / Right walk the list, Up / Down move one row, Home / End jump to the
 * ends. Down from a full row onto a shorter last row lands on its last item.
 */
export function gridStep(key: string, cur: number, last: number, cols: number): number | null {
  if (last < 0) return null
  const c = Math.max(1, cols)
  const i = Math.min(Math.max(0, cur), last)
  switch (key) {
    case 'ArrowLeft': return c === 1 ? null : Math.max(0, i - 1)
    case 'ArrowRight': return c === 1 ? null : Math.min(last, i + 1)
    case 'ArrowUp': return i - c >= 0 ? i - c : i
    case 'ArrowDown': {
      const onLastRow = Math.floor(i / c) === Math.floor(last / c)
      return i + c <= last ? i + c : onLastRow ? i : last
    }
    case 'Home': return 0
    case 'End': return last
    default: return null
  }
}

/** How many columns a CSS grid is laying out right now. */
export function gridColumnCount(el: HTMLElement | null): number {
  if (!el) return 1
  const cols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length
  return Math.max(1, cols)
}

/**
 * Where a key press starts from: the focused card (a Tab or a click can put
 * focus on a card other than the selected one), else the selection.
 */
export function stepOrigin(target: EventTarget | null, games: readonly { id: string }[], selectedIndex: number): number {
  const id = target instanceof HTMLElement ? target.dataset.gameId : undefined
  const at = id ? games.findIndex(g => g.id === id) : -1
  return at >= 0 ? at : selectedIndex
}
