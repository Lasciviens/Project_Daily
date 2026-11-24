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

export interface QueueMovieItem { tmdb: number | null; listedAt: string | null }
/** A library film: its status, and when each of its watches was recorded here (`media_watches.created_at`). */
export interface QueueLibraryMovie { status: string; recordedAt: readonly string[] }

/**
 * The films that leave the Queue: Completed in the library, with a watch
 * recorded since they were put in the Queue — however it came (marked in the
 * app, on Trakt, a scrobble). A Completed film queued again to rewatch
 * stays until that rewatch is recorded. Unknown dates keep the film.
 */
export function queueMoviesWatched(items: readonly QueueMovieItem[], library: ReadonlyMap<number, QueueLibraryMovie>): number[] {
  const out = new Set<number>()
  for (const i of items) {
    if (!i.tmdb || !i.listedAt) continue
    const listed = Date.parse(i.listedAt)
    const lib = library.get(i.tmdb)
    if (!Number.isFinite(listed) || lib?.status !== 'completed') continue
    if (lib.recordedAt.some(t => Date.parse(t) >= listed)) out.add(i.tmdb)
  }
  return [...out]
}
