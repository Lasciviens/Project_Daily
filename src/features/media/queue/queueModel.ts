// The Queue: one private Trakt list named "Queue", ordered by rank, so Trakt
// shows the same order the app does. It can never be deleted (207,
// trakt/traktQueue.ts). Pure (scripts/verify-media-queue.cjs).

import { QUEUE_LIST_NAME, isQueueName } from '../trakt/traktQueue'

export const QUEUE_NAME = QUEUE_LIST_NAME

/**
 * The Queue list among your Trakt lists: the one trakt-api flags (`queue`, by
 * its id kept in the database); before the function flags any, the oldest
 * named "Queue" (any case).
 */
export function findQueueList<T extends { id: number; name: string; queue?: boolean }>(lists: readonly T[] | undefined): T | null {
  const all = lists ?? []
  const flagged = all.find(l => l.queue === true)
  if (flagged) return flagged
  if (all.some(l => l.queue === false)) return null
  return all.filter(l => isQueueName(l.name)).sort((a, b) => a.id - b.id)[0] ?? null
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
