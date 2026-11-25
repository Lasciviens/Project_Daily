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

/**
 * Where a dragged row lands: the place of the row it is over (the rows in
 * between shift by one). Null when it would stay where it is.
 */
export function queueDropTarget(from: number, over: number | null, count: number): number | null {
  if (over == null || over === from || from < 0 || from >= count || over < 0 || over >= count) return null
  return over
}

/**
 * While a row is dragged from `from` towards `to`: which way row `n` steps
 * aside to open the gap (-1 up, 1 down, 0 stays). The dragged row itself
 * follows the pointer (0 here).
 */
export function queueShift(n: number, from: number, to: number | null): -1 | 0 | 1 {
  if (to == null || n === from) return 0
  if (from < to && n > from && n <= to) return -1
  if (to < from && n >= to && n < from) return 1
  return 0
}

/** How far a dragged row may move: its top never above the list's top, its bottom never below the list's bottom. */
export function clampDragY(y: number, row: { top: number; bottom: number }, list: { top: number; bottom: number }): number {
  return Math.min(Math.max(y, list.top - row.top), list.bottom - row.bottom)
}

/** The keyboard way to move a row: Alt+↑ / Alt+↓ on any control in it. The new place, or null. */
export function queueKeyMove(key: string, altKey: boolean, index: number, count: number): number | null {
  if (!altKey) return null
  const to = key === 'ArrowUp' ? index - 1 : key === 'ArrowDown' ? index + 1 : null
  return to == null || to < 0 || to >= count ? null : to
}
