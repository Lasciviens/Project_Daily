// Pure helpers for the Play Queue view's Move up / Move down buttons.

export interface QueueItem { id: string; play_order: number | null }
export interface QueueUpdate { id: string; play_order: number }

/**
 * The queue with not-yet-refetched moves applied, re-sorted into play order.
 * Overrides only live while a reorder is in flight, so a button press moves
 * the row at once instead of after the round trip.
 */
export function withOrderOverrides<T extends QueueItem>(games: T[], overrides: Record<string, number>): T[] {
  if (Object.keys(overrides).length === 0) return games
  const order = (g: T) => overrides[g.id] ?? g.play_order ?? Number.MAX_SAFE_INTEGER
  return games
    .map((g, i) => ({ g, i }))
    .sort((a, b) => order(a.g) - order(b.g) || a.i - b.i)
    .map(x => x.g)
}

/**
 * The two writes that swap the games at `from` and `to`.
 *
 * A swap of the two stored values, never a renumbering: the list on screen can
 * be a subset of the real queue (a search, a genre filter, hidden rows), and
 * renumbering the subset 1…n would collide with the rows it does not show.
 * Two rows that share a value (a race between two "Add to Play Queue" taps)
 * cannot be swapped, so the displaced one is pushed one slot later instead.
 */
export function swapUpdates(list: QueueItem[], from: number, to: number): QueueUpdate[] | null {
  const a = list[from]
  const b = list[to]
  if (!a || !b || a.play_order == null || b.play_order == null) return null
  if (a.play_order !== b.play_order) {
    return [{ id: a.id, play_order: b.play_order }, { id: b.id, play_order: a.play_order }]
  }
  const [first, second] = from < to ? [b, a] : [a, b]
  return [{ id: first.id, play_order: a.play_order }, { id: second.id, play_order: a.play_order + 1 }]
}
