import { useMemo } from 'react'
import { todayStr } from '../../../shared/utils/dateUtils'
import { libraryItems, type LibraryItem } from '../libraryModel'
import { libraryKey } from '../listModel'
import { useCinemaVisits } from './useCinemaVisits'
import { useMovies } from './useMovies'
import { useTVSeries } from './useTVSeries'

/** Movie ids (catalogue rows) watched at a cinema at least once. */
export function useCinemaMovieIds(): ReadonlySet<string> {
  const { data: visits = [] } = useCinemaVisits()
  return useMemo(() => new Set(visits.map(v => v.movie_id)), [visits])
}

/** The whole library by `movie:<tmdb>` / `tv:<tmdb>` — status ribbons on posters outside the Library. */
export function useLibraryIndex(): ReadonlyMap<string, LibraryItem> {
  const { data: movies = [] } = useMovies()
  const { data: tv = [] } = useTVSeries()
  const cinema = useCinemaMovieIds()
  return useMemo(() => {
    const today = todayStr()
    const out = new Map<string, LibraryItem>()
    for (const i of libraryItems('movies', movies, tv, today, cinema)) out.set(libraryKey('movie', i.tmdbId), i)
    for (const i of libraryItems('tv', movies, tv, today)) out.set(libraryKey('tv', i.tmdbId), i)
    return out
  }, [movies, tv, cinema])
}
