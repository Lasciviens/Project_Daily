import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk, STALE } from '../../../shared/query'
import { fetchAllWatchedEpisodeRows } from '../api/watchedEpisodesApi'
import { useMovies } from './useMovies'
import { useTVSeries } from './useTVSeries'
import { buildYearReview, reviewYears, unknownDateCount, type ReviewEpisode, type ReviewMovie, type ReviewShow } from '../yearReview'

const names = (g: { name: string }[] | null | undefined) => (g ?? []).map(x => x.name)

/** The inputs Year in review needs, from the library plus every watched episode row. */
export function useYearReview(year: number | null) {
  const { data: movieEntries = [], isLoading: ml } = useMovies()
  const { data: tvEntries = [], isLoading: tl } = useTVSeries()
  const rows = useQuery({ queryKey: qk.media.episodeRows(), queryFn: fetchAllWatchedEpisodeRows, staleTime: STALE.long })

  return useMemo(() => {
    const movies: ReviewMovie[] = movieEntries
      .filter(e => e.watched_at && (e.status === 'completed' || e.status === 'watching' || e.status === 'dropped'))
      .map(e => ({
        tmdbId: e.movie.tmdb_id, title: e.movie.title, poster: e.movie.poster_path, runtime: e.movie.runtime,
        genres: names(e.movie.genres), watchedAt: e.watched_at!, plays: 1 + Math.max(0, e.repeat_count ?? 0),
      }))
    const shows = new Map<string, ReviewShow>(tvEntries.map(e => [e.tv_series_id, {
      tmdbId: e.tv_series.tmdb_id, title: e.tv_series.title, poster: e.tv_series.poster_path,
      runtime: e.tv_series.episode_run_time, genres: names(e.tv_series.genres),
    }]))
    const episodes: ReviewEpisode[] = (rows.data ?? []).map(r => ({
      showId: r.tv_series_id, season: r.season_number, episode: r.episode_number,
      watchedAt: r.watched_at, plays: 1 + Math.max(0, r.repeat_count ?? 0),
    }))
    const years = reviewYears(movies, episodes)
    const picked = year ?? years[0] ?? new Date().getFullYear()
    return {
      loading: ml || tl || rows.isLoading,
      error: rows.error as Error | null,
      years,
      review: buildYearReview(picked, movies, episodes, shows),
      unknown: unknownDateCount(movies, episodes),
    }
  }, [movieEntries, tvEntries, rows.data, rows.isLoading, rows.error, ml, tl, year])
}
