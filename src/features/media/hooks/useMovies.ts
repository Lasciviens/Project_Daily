import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { scheduleTraktSync } from '../trakt/traktAutoSync'
import {
  fetchUserMovieEntries,
  upsertMovie,
  addMovieEntry,
  updateMovieEntry,
} from '../api/moviesApi'
import type { UserMovieEntry, TMDBMovie } from '../types'

export function useMovies() {
  return useQuery({
    queryKey: qk.media.userMovies(),
    queryFn:  fetchUserMovieEntries,
    staleTime: STALE.default,
  })
}

/** The user's library entry for one TMDB movie (a projection of the list). */
export function useMovieEntryByTmdb(tmdbId: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.media.userMovies(),
    queryFn:  fetchUserMovieEntries,
    staleTime: STALE.default,
    enabled:  enabled && tmdbId != null,
    select:   (list: UserMovieEntry[]) => list.find(e => e.movie.tmdb_id === tmdbId) ?? null,
  })
}

// Callers pass their own success copy (withProgress) — the same hook adds,
// rates, notes and completes, so one fixed message would be wrong for most.
export function useAddMovie() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'add_movie',
    silent: 'callers report the result (the same hook adds, rates, notes and completes)',
    mutationFn: async ({
      tmdb,
      status,
      priority,
      watchedAt,
    }: {
      tmdb: TMDBMovie
      status: UserMovieEntry['status']
      priority?: UserMovieEntry['priority']
      /** Completed: the answer from the when-watched sheet (null = unknown date). */
      watchedAt?: string | null
    }) => {
      const movie = await upsertMovie(tmdb)
      return addMovieEntry(movie.id, status, priority, watchedAt !== undefined ? { watched_at: watchedAt } : {})
    },
    invalidates: ['media'],
    // The title reads "in library" from these lists: until they have it, a
    // second tap would add it again (and hit the unique key).
    refresh: 'wait',
    onSuccess: () => scheduleTraktSync(qc),
  })
}

export function useUpdateMovie() {
  const qc = useQueryClient()
  return useMutationWithFeedback({
    action: 'update_movie',
    silent: 'callers report the result (the same hook adds, rates, notes and completes)',
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateMovieEntry>[1] }) =>
      updateMovieEntry(id, patch),
    invalidates: ['media'],
    onSuccess: () => scheduleTraktSync(qc),
  })
}

/**
 * Removes a title from the library with Undo.
 * The Trakt outbox sends the removal; Undo puts the same rows back (its
 * watches too) and the outbox sends them again (each watch at its own date,
 * migration 149; the Trakt note is made anew, so the old link is cleared).
 */
export function useDeleteMovie() {
  const qc = useQueryClient()
  return useRowsDelete({
    table: 'user_movie_entries', action: 'delete_movie', invalidates: ['media'], cache: qk.media.movies,
    overrides: () => ({ user_movie_entries: { trakt_note_id: null, trakt_note_text: null } }),
    afterDelete: () => scheduleTraktSync(qc),
    afterRestore: () => { scheduleTraktSync(qc) },
  })
}
