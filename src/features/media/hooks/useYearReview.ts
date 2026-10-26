import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchAllWatchedEpisodeRows, type WatchedEpisodeRow } from '../api/watchedEpisodesApi'
import { useMovies } from './useMovies'
import { useTVSeries } from './useTVSeries'
import { buildYearReview, reviewYears, unknownDateCount, watchesBetween, type ReviewEpisode, type ReviewMovie, type ReviewShow } from '../yearReview'
import type { UserMovieEntry, UserTVEntry } from '../types'

const names = (g: { name: string }[] | null | undefined) => (g ?? []).map(x => x.name)

/** The library and every watched episode row, as the year review reads them. */
function useReviewInputs() {
  const { data: movieEntries = [], isLoading: ml } = useMovies()
  const { data: tvEntries = [], isLoading: tl } = useTVSeries()
  const rows = useQuery({ queryKey: qk.media.episodeRows(), queryFn: fetchAllWatchedEpisodeRows, staleTime: STALE.long })
  return { movieEntries, tvEntries, rows, ml, tl }
}

/** One period's stats (a year, or `'all'`), from the library plus every watched episode row. */
export function useYearReview(period: number | 'all' | null) {
  const { movieEntries, tvEntries, rows, ml, tl } = useReviewInputs()

  return useMemo(() => {
    const { movies, episodes, shows } = reviewData(movieEntries, tvEntries, rows.data ?? [])
    const years = reviewYears(movies, episodes)
    const picked = period === 'all' ? null : (period ?? years[0] ?? new Date().getFullYear())
    return {
      loading: ml || tl || rows.isLoading,
      error: rows.error as Error | null,
      years,
      review: buildYearReview(picked, movies, episodes, shows),
      unknown: unknownDateCount(movies, episodes),
    }
  }, [movieEntries, tvEntries, rows.data, rows.isLoading, rows.error, ml, tl, period])
}

/** The year review's inputs from the library rows (one mapping for every reader). */
function reviewData(movieEntries: UserMovieEntry[], tvEntries: UserTVEntry[], rowsData: WatchedEpisodeRow[]) {
  // A completed film with no watch date still counts all time ("unknown date").
  // Every watch on its own date (migration 149); before it, the plays at the one kept date.
  const movies: ReviewMovie[] = movieEntries
    // A Watching/Dropped film with a date counts as before (it has no watch rows: a play exists only once completed).
    .filter(e => (e.watches?.length ?? 0) > 0 || e.status === 'completed' || (e.watched_at && (e.status === 'watching' || e.status === 'dropped')))
    .map(e => ({
      tmdbId: e.movie.tmdb_id, title: e.movie.title, poster: e.movie.poster_path, runtime: e.movie.runtime,
      genres: names(e.movie.genres), watchedAt: e.watched_at ?? '', plays: e.watches?.length || 1 + Math.max(0, e.repeat_count ?? 0),
      watches: e.watches?.length ? e.watches.map(w => w.watched_at ?? '') : undefined,
      rating: e.rating, tmdbRating: e.movie.tmdb_rating,
    }))
  const shows = new Map<string, ReviewShow>(tvEntries.map(e => [e.tv_series_id, {
    tmdbId: e.tv_series.tmdb_id, title: e.tv_series.title, poster: e.tv_series.poster_path,
    runtime: e.tv_series.episode_run_time, genres: names(e.tv_series.genres),
    rating: e.rating, tmdbRating: e.tv_series.tmdb_rating,
  }]))
  const episodes: ReviewEpisode[] = rowsData.map(r => ({
    showId: r.tv_series_id, season: r.season_number, episode: r.episode_number,
    watchedAt: r.watched_at, plays: r.watches?.length || 1 + Math.max(0, r.repeat_count ?? 0),
    watches: r.watches?.length ? r.watches.map(w => w.watched_at) : undefined,
  }))
  return { movies, episodes, shows }
}

/** Personal's Watching card for `day`: the last 7 days and the last 30 (each
 *  watch on its own day, lengths by the year review's runtime rule), the
 *  latest titles watched up to the day, and the library — for the picks. */
export function useWatchingGlance(day: string) {
  const { movieEntries, tvEntries, rows, ml, tl } = useReviewInputs()
  return useMemo(() => {
    const { movies, episodes, shows } = reviewData(movieEntries, tvEntries, rows.data ?? [])
    const shift = (n: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
    return {
      loading: ml || tl || rows.isLoading,
      last30: watchesBetween(shift(-29), day, movies, episodes, shows),
      lately: watchesBetween(shift(-180), day, movies, episodes, shows),
      movieEntries,
      tvEntries,
    }
  }, [movieEntries, tvEntries, rows.data, rows.isLoading, ml, tl, day])
}
