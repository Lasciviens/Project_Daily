import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import {
  fetchUserMovieEntries,
  upsertMovie,
  addMovieEntry,
  updateMovieEntry,
  deleteMovieEntry,
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
  return useMutationWithFeedback({
    action: 'add_movie',
    mutationFn: async ({
      tmdb,
      status,
      priority,
    }: {
      tmdb: TMDBMovie
      status: UserMovieEntry['status']
      priority?: UserMovieEntry['priority']
    }) => {
      const movie = await upsertMovie(tmdb)
      return addMovieEntry(movie.id, status, priority)
    },
    invalidates: ['media'],
  })
}

export function useUpdateMovie() {
  return useMutationWithFeedback({
    action: 'update_movie',
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateMovieEntry>[1] }) =>
      updateMovieEntry(id, patch),
    invalidates: ['media'],
  })
}

export function useDeleteMovie() {
  return useMutationWithFeedback({
    action: 'delete_movie',
    mutationFn: (id: string) => deleteMovieEntry(id),
    invalidates: ['media'],
  })
}
