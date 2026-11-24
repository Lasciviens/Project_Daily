// The Queue's server rules (migration 207), pure: GENERATED into trakt-api by
// scripts/sync-trakt-shared.mjs and checked by scripts/verify-media-queue.cjs.
//
// The Queue is one private Trakt list. Which one is decided by its Trakt list
// id, kept in `trakt_queue_lists` (written only by trakt-api; the database
// refuses to delete or change a row) — never by its name alone, which anyone
// can change on Trakt. It can never be deleted (owner, 24.11.2026).

export const QUEUE_LIST_NAME = 'Queue'

export const isQueueName = (name: string | null | undefined) =>
  (name ?? '').trim().toLowerCase() === QUEUE_LIST_NAME.toLowerCase()

/**
 * Which of the account's lists is the Queue: the oldest one the database
 * marks; with none marked, the oldest named "Queue" — `adopt` says it must be
 * marked now. Null: the account has no Queue (yet).
 */
export function queueListOf<T extends { id: number | null; name: string }>(
  lists: readonly T[], marked: ReadonlySet<number>,
): { id: number; adopt: boolean } | null {
  const ids = (pick: (l: T) => boolean) => lists.filter(l => typeof l.id === 'number' && l.id > 0 && pick(l)).map(l => l.id as number).sort((a, b) => a - b)
  const known = ids(l => marked.has(l.id as number))
  if (known.length) return { id: known[0], adopt: false }
  const named = ids(l => isQueueName(l.name))
  return named.length ? { id: named[0], adopt: true } : null
}

export interface QueueMovieItem { tmdb: number | null }

/**
 * The films that leave the Queue (owner, 24.11.2026: "Completed movie should
 * get out of the queue"): every film whose library status is Completed,
 * whenever and however it was watched (the app, Trakt, a scrobble). A film
 * being watched again is Watching (161), not Completed, so it stays until the
 * rewatch ends; adding a Completed film asks to start a rewatch first
 * (`useQueueAddCheck`). `status` maps a TMDB id to its library status.
 */
export function queueMoviesCompleted(items: readonly QueueMovieItem[], status: ReadonlyMap<number, string>): number[] {
  const out = new Set<number>()
  for (const i of items) if (i.tmdb && status.get(i.tmdb) === 'completed') out.add(i.tmdb)
  return [...out]
}

/** Putting a title in the Queue asks to start a rewatch first: only a film the library has as Completed. */
export const queueAddNeedsRewatch = (type: 'movie' | 'show', status: string | null | undefined) =>
  type === 'movie' && status === 'completed'
