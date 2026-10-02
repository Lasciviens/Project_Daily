// The Queue: one private Trakt list named "Queue", ordered by rank, so Trakt
// shows the same order the app does. Pure (scripts/verify-media-queue.cjs).

export const QUEUE_NAME = 'Queue'

/** The Queue list among your Trakt lists (the name, any case; the oldest if several). */
export function findQueueList<T extends { id: number; name: string }>(lists: readonly T[] | undefined): T | null {
  const q = (lists ?? []).filter(l => l.name.trim().toLowerCase() === QUEUE_NAME.toLowerCase())
  return q.sort((a, b) => a.id - b.id)[0] ?? null
}

/** `items` with the one at `from` moved to `to` (clamped); a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items]
  if (from < 0 || from >= out.length) return out
  const target = Math.max(0, Math.min(out.length - 1, to))
  const [it] = out.splice(from, 1)
  out.splice(target, 0, it)
  return out
}

/** Items in queue order: Trakt's rank, then when they were added. */
export function sortQueue<T extends { rank: number | null; listedAt: string | null }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.listedAt ?? '').localeCompare(b.listedAt ?? ''))
}
