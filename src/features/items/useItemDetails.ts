// The item screen's details (215) — its reads and the one step a pick needs. The details themselves are saved only by
// the one item save (useSaveItem → app_save_item's p_details); nothing here writes them.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '../../app/store'
import { qk, STALE } from '../../shared/query'
import { getMovieFull, getTVFull } from '../media/api/tmdbApi'
import { fetchUserMovieEntries } from '../media/api/moviesApi'
import { fetchUserTVEntries } from '../media/api/tvApi'
import { useAddMovie } from '../media/hooks/useMovies'
import { useAddTV } from '../media/hooks/useTVSeries'
import { useCinemaVisits } from '../media/hooks/useCinemaVisits'
import { cleanDetails } from './categoryDetails'
import { fetchEarlierDetails } from './itemApi'

/** What earlier items' details hold, with their places — the suggestions (read when the section shows). */
export function useEarlierDetails(enabled: boolean) {
  return useQuery({ queryKey: qk.items.earlierDetails(), queryFn: fetchEarlierDetails, staleTime: STALE.default, enabled })
}

/** What a cinema place row suggests first: the places of earlier cinema trips, then the cinemas of past visits (120).
 *  Rows are input: PlaceRow cleans each one (placeOfRow). */
export function useEarlierCinemas(enabled: boolean): unknown[] {
  const earlier = useEarlierDetails(enabled)
  const visits = useCinemaVisits(enabled)
  return [
    ...(earlier.data ?? []).filter(r => cleanDetails(r.details)?.type === 'cinema' && r.place).map(r => r.place),
    ...(visits.data ?? []).filter(v => v.cinema).map(v => ({ name: v.cinema, ...(v.location ? { locality: v.location } : {}) })),
  ]
}

/**
 * A title picked from TMDB's search for a plan: its library entry, added first through the library's own add (Want to
 * watch) when it isn't there — so the plan's link always names a real entry (owner, 27.11.2026). Resolves the entry's
 * id, or null when it couldn't be added (the add's hook said why).
 */
export function useLibraryEntryForPlan() {
  const qc = useQueryClient()
  const addMovie = useAddMovie()
  const addTV = useAddTV()
  return async (kind: 'movie' | 'tv', tmdbId: number, title: string): Promise<string | null> => {
    // TMDB's id (an outside answer) goes into a request path: only a positive whole number.
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null
    // Already there (the list may be older than this screen): its own entry, never a second one.
    const list = kind === 'movie'
      ? (await qc.fetchQuery({ queryKey: qk.media.userMovies(), queryFn: fetchUserMovieEntries, staleTime: STALE.default })).find(e => e.movie.tmdb_id === tmdbId)
      : (await qc.fetchQuery({ queryKey: qk.media.userTv(), queryFn: fetchUserTVEntries, staleTime: STALE.default })).find(e => e.tv_series.tmdb_id === tmdbId)
    if (list) return list.id
    const tid = toast.loading(`Adding “${title}” to the library…`)
    let full: unknown
    try {
      full = kind === 'movie'
        ? await qc.fetchQuery({ queryKey: qk.media.tmdbQuery('full', 'movie', tmdbId), queryFn: () => getMovieFull(tmdbId), staleTime: STALE.hour })
        : await qc.fetchQuery({ queryKey: qk.media.tmdbQuery('full', 'tv', tmdbId), queryFn: () => getTVFull(tmdbId), staleTime: STALE.hour })
    } catch (e) {
      toast.dismiss(tid)
      toast.error(`Couldn't read “${title}” from TMDB: ${(e as Error).message}`)
      return null
    }
    try {
      const entry = kind === 'movie'
        ? await addMovie.mutateAsync({ tmdb: full as Parameters<typeof addMovie.mutateAsync>[0]['tmdb'], status: 'wishlist' })
        : await addTV.mutateAsync({ tmdb: full as Parameters<typeof addTV.mutateAsync>[0]['tmdb'], status: 'wishlist' })
      toast.dismiss(tid)
      toast.success(`Added to the library · ${title}`)
      return entry.id
    } catch {
      // The library add's own hook said why.
      toast.dismiss(tid)
      return null
    }
  }
}
