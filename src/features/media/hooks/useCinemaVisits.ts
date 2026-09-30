import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { qk, STALE } from '../../../shared/query'
import { deleteCinemaVisits, fetchCinemaVisits, saveCinemaVisit, type CinemaVisit, type CinemaVisitInput } from '../api/cinemaApi'

/** Every cinema visit (one small list) — the library marks posters from it. */
export function useCinemaVisits() {
  return useQuery({ queryKey: qk.media.cinemaVisits(), queryFn: fetchCinemaVisits, staleTime: STALE.default })
}

/** One movie's visits, newest first (a projection of the same list). */
export function useMovieCinemaVisits(movieId: string | null | undefined) {
  return useQuery({
    queryKey: qk.media.cinemaVisits(),
    queryFn: fetchCinemaVisits,
    staleTime: STALE.default,
    enabled: !!movieId,
    select: (all: CinemaVisit[]) => all.filter(v => v.movie_id === movieId),
  })
}

export function useSaveCinemaVisit() {
  return useMutationWithFeedback({
    action: 'save_cinema_visit',
    mutationFn: ({ id, input }: { id: string | null; input: CinemaVisitInput }) => saveCinemaVisit(id, input),
    successMessage: 'Saved',
    invalidates: [qk.media.cinemaVisits()],
  })
}

export function useDeleteCinemaVisit() {
  return useMutationWithFeedback({
    action: 'delete_cinema_visit',
    mutationFn: (ids: string[]) => deleteCinemaVisits(ids),
    successMessage: 'Removed',
    invalidates: [qk.media.cinemaVisits()],
  })
}
