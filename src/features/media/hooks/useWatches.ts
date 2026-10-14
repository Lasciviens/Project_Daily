import { useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { scheduleTraktSync } from '../trakt/traktAutoSync'
import { addWatches, NEEDS_149, setWatchDates } from '../api/watchesApi'
import { updateMovieEntry } from '../api/moviesApi'
import { updateTVEntry } from '../api/tvApi'
import type { UserMovieEntry } from '../types'

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

/** A new date for one chosen watch of a movie; before 149 the movie's one kept date. */
export function useSetMovieWatchDate() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'set_movie_watch_date',
    silent: 'the movie controls report the result ("Watched date changed")',
    mutationFn: async ({ entry, watchId, at }: { entry: UserMovieEntry; watchId: string | null; at: string | null }) => {
      if (watchId) await setWatchDates([{ id: watchId, target: { kind: 'movie', movieEntryId: entry.id }, at }])
      else await updateMovieEntry(entry.id, { watched_at: at })
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
