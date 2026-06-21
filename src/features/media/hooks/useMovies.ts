import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
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
    queryKey: ['movies', 'user'],
    queryFn:  fetchUserMovieEntries,
    staleTime: 5 * 60_000,
  })
}

export function useAddMovie() {
  const qc = useQueryClient()
  return useMutation({
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['movies', 'user'] }),
  })
}

export function useUpdateMovie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof updateMovieEntry>[1] }) =>
      updateMovieEntry(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['movies', 'user'] }),
  })
}

export function useDeleteMovie() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteMovieEntry(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['movies', 'user'] }),
  })
}
