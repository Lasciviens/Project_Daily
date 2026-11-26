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

/** A library title's own entry by `movie:<tmdb>` / `tv:<tmdb>` (its id and a movie's runtime): what a Plan links to. */
export function useLibraryEntries(): ReadonlyMap<string, { entryId: string; runtime: number | null }> {
  const { data: movies = [] } = useMovies()
  const { data: tv = [] } = useTVSeries()
  return useMemo(() => {
    const out = new Map<string, { entryId: string; runtime: number | null }>()
    for (const m of movies) if (m.movie?.tmdb_id) out.set(libraryKey('movie', m.movie.tmdb_id), { entryId: m.id, runtime: m.movie.runtime ?? null })
    for (const s of tv) if (s.tv_series?.tmdb_id) out.set(libraryKey('tv', s.tv_series.tmdb_id), { entryId: s.id, runtime: null })
    return out
  }, [movies, tv])
}
