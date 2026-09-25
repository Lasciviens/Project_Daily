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
 * Each row's play_order as it will be once the in-flight moves land. A swap
 * must be built from THESE values, not the fetched ones: the rows on screen
 * already sit where the overrides put them, and swapping their stale stored
 * values would write two rows onto one slot.
 */
export function effectiveOrder(games: QueueItem[], overrides: Record<string, number>): QueueItem[] {
  return games.map(g => ({ id: g.id, play_order: overrides[g.id] ?? g.play_order }))
}

/**
 * The number printed on each row. `ranks` is every row's place in the WHOLE
 * queue (a search can show a subset); while a move is in flight a row takes the
 * rank of the row whose stored slot it now holds, so the numbers travel with
 * the rows instead of lagging a round trip behind.
 */
export function displayRanks(
  games: QueueItem[], ranks: ReadonlyMap<string, number>, overrides: Record<string, number>,
): Map<string, number> {
  const rankOfSlot = new Map<number, number>()
  for (const g of games) {
    const r = ranks.get(g.id)
    if (g.play_order != null && r != null && !rankOfSlot.has(g.play_order)) rankOfSlot.set(g.play_order, r)
  }
  const out = new Map<string, number>()
  for (const g of games) {
    const slot = overrides[g.id]
    const r = (slot != null ? rankOfSlot.get(slot) : undefined) ?? ranks.get(g.id)
    if (r != null) out.set(g.id, r)
  }
  return out
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
