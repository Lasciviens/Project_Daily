import { useQuery } from '@tanstack/react-query'
import { useMutationWithFeedback } from '../../../shared/hooks/useMutationWithFeedback'
import { useRowsDelete } from '../../../shared/hooks/useRowsDelete'
import { qk, STALE } from '../../../shared/query'
import { fetchCinemaVisits, saveCinemaVisit, type CinemaVisit, type CinemaVisitInput } from '../api/cinemaApi'

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
    successMessage: (_r, { id }) => (id ? 'Cinema visit saved' : 'Cinema visit added'),
    invalidates: [qk.media.cinemaVisits()],
  })
}

export function useDeleteCinemaVisit() {
  return useRowsDelete({ table: 'movie_cinema_visits', action: 'delete_cinema_visit', invalidates: [qk.media.cinemaVisits()], cache: qk.media.cinemaVisits() })
}
