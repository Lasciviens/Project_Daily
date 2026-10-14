import { useQueryClient } from '@tanstack/react-query'
import { toast } from '../../../app/store'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { scheduleTraktSync } from '../trakt/traktAutoSync'
import { addWatches, NEEDS_149, NEEDS_149_DATES, setWatchDates } from '../api/watchesApi'
import { confirmDelete } from '../../../shared/modals/deleteFlow'
import { updateMovieEntry } from '../api/moviesApi'
import { updateTVEntry } from '../api/tvApi'
import type { UserMovieEntry } from '../types'
import { isPlaceholder } from '../watches'

/** What the screens say when a change would touch a placeholder (the database's own words, migration 149). */
export const WAITS_FOR_TRAKT = "This watch waits for Trakt's dates — try again after the next Trakt sync"

// Watches of a movie, the delete of any watch, and starting a rewatch
// (migration 149). Episodes are marked and watched again through
// useMarkEpisodeWatched — the one episode write path.

/** One more watch of a movie at its own time (Watched again); every other watch keeps its date. */
export function useAddMovieWatch() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'add_movie_watch',
    silent: 'the movie controls report the result ("Watch added")',
    mutationFn: async ({ entry, at }: { entry: UserMovieEntry; at: string | null }) => {
      try {
        await addWatches([{ target: { kind: 'movie', movieEntryId: entry.id }, at }])
      } catch (e) {
        if (!(e instanceof Error) || e.message !== NEEDS_149) throw e
        // Before 149: one more play, the kept date moves to it (an unknown date keeps the old one).
        await updateMovieEntry(entry.id, { repeat_count: (entry.repeat_count ?? 0) + 1, ...(at ? { watched_at: at } : {}) })
      }
    },
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}

/**
 * A new date for one chosen watch of a movie. Without a watch to name (before
 * migration 149) nothing is written: the old one-date path re-sent every play.
 */
export function useSetMovieWatchDate() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'set_movie_watch_date',
    silent: 'the movie controls report the result ("Watched date changed")',
    mutationFn: async ({ entry, watchId, at }: { entry: UserMovieEntry; watchId: string | null; at: string | null }) => {
      if (!watchId) throw new Error(NEEDS_149_DATES)
      await setWatchDates([{ id: watchId, target: { kind: 'movie', movieEntryId: entry.id }, at }])
    },
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}

/**
 * Removes watches with Undo (the one delete flow). On Trakt only those plays
 * go; the last watch of an episode makes it not watched, of a movie puts it
 * back on the Wishlist. Undo adds them again as new plays (their old Trakt
 * link is dropped — Trakt removed those plays).
 */
export function useDeleteWatches() {
  const qc = useQueryClient()
  return useRowsDelete({
    table: 'media_watches', action: 'delete_watch', invalidates: ['episodeWatched', 'media'],
    overrides: () => ({ media_watches: { trakt_history_id: null, source: 'app' } }),
    afterDelete: () => scheduleTraktSync(qc),
    afterRestore: () => { scheduleTraktSync(qc) },
    names: { media_watches: 'watches' },
  })
}

/**
 * "Not watched" for a movie — its button, or Wishlist picked on a watched
 * movie: asks, then Wishlist with no watches. The status is the unmark: the
 * database removes every watch and sends the movie-wide remove to Trakt
 * (every play of it, the ones the app doesn't know too). "· Undo" adds its
 * watches back, each at its own date (new plays on Trakt), and its status.
 * A movie whose watches wait for Trakt's dates is left as it is.
 */
export function useMovieNotWatched() {
  const qc = useQueryClient()
  const clear = useMutationWithFeedback({
    action: 'movie_not_watched',
    silent: 'the delete flow reports the result',
    mutationFn: async (entry: UserMovieEntry) => {
      // Before 149 (no watch list) the cache columns are still the data.
      await updateMovieEntry(entry.id, entry.watches ? { status: 'wishlist' } : { status: 'wishlist', watched_at: null, repeat_count: 0 })
      return { dates: (entry.watches ?? []).map(w => w.watched_at), status: entry.status }
    },
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
  const putBack = useMutationWithFeedback({
    action: 'movie_not_watched_undo',
    silent: 'the delete flow reports the result',
    mutationFn: async ({ entry, was }: { entry: UserMovieEntry; was: { dates: (string | null)[]; status: UserMovieEntry['status'] } }) => {
      // The first watch makes it Completed again; another status it had comes back after.
      await addWatches(was.dates.map(at => ({ target: { kind: 'movie' as const, movieEntryId: entry.id }, at })))
      if (was.status !== 'completed') await updateMovieEntry(entry.id, { status: was.status })
    },
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
  function run(entry: UserMovieEntry, traktWaits: boolean) {
    if (entry.watches?.some(w => isPlaceholder(w, traktWaits))) {
      toast.info(WAITS_FOR_TRAKT)
      return Promise.resolve(null)
    }
    const n = entry.watches?.length ?? 1 + Math.max(0, entry.repeat_count ?? 0)
    return confirmDelete<{ dates: (string | null)[]; status: UserMovieEntry['status'] }>({
      title: 'Mark as not watched?',
      message: `Removes ${n === 1 ? 'its watch' : `all ${n} watches`} here and EVERY play of it on Trakt — the ones the app doesn't know too. It goes back to your Wishlist.`,
      confirmLabel: 'Mark not watched',
      remove: () => clear.mutateAsync(entry),
      isEmpty: () => false,
      restore: async was => { await putBack.mutateAsync({ entry, was }) },
      canUndo: was => was.dates.length > 0,
      done: 'Marked as not watched',
      restored: 'Watches back',
    })
  }
  return { run, busy: clear.isPending || putBack.isPending }
}

const rewatchFailed = (e: unknown) =>
  ['42703', 'PGRST204'].includes(String((e as { code?: string })?.code ?? '')) ? new Error('Watching again needs migration 149 (rewatch rounds) — it is not applied yet') : e

/**
 * Watch a finished title again: Watching, rewatch round N (one more than its
 * fewest watches). Progress then follows the round; the watch that finishes
 * it makes the title Completed again (the database does that, migration 149).
 */
export function useStartRewatch() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'start_rewatch',
    silent: 'the status picker reports the result ("Watching again · round 2")',
    mutationFn: async ({ kind, id, round }: { kind: 'movie' | 'tv'; id: string; round: number }) => {
      const patch = { status: 'watching' as const, rewatch_round: round }
      try {
        if (kind === 'movie') await updateMovieEntry(id, patch)
        else await updateTVEntry(id, patch)
      } catch (e) { throw rewatchFailed(e) }
    },
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}
