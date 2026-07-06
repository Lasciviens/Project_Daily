import type { UserMovieEntry, UserTVEntry } from '../types'

export interface MediaStats {
  moviesWatched:    number
  moviesWishlist:   number
  hoursWatched:     number
  tvSeriesTracked:  number
  tvEpisodesWatched: number
  tvHoursWatched:   number
  avgMyRating:      number | null
  avgTMDBRating:    number | null
  topGenres:        { name: string; count: number }[]
}

export function computeMediaStats(movies: UserMovieEntry[], tv: UserTVEntry[]): MediaStats {
  const completed  = movies.filter(e => e.status === 'completed')

  // Movie hours: runtime × (1 + repeat_count) for each completed film
  const movieMins  = completed.reduce((s, e) => s + (e.movie.runtime ?? 90) * (1 + e.repeat_count), 0)

  // TV episodes: rough estimate per series using season/episode position
  let tvEpisodes = 0
  let tvMins     = 0
  for (const e of tv) {
    if (e.status === 'completed') {
      tvEpisodes += e.tv_series.number_of_episodes ?? 0
      tvMins     += (e.tv_series.number_of_episodes ?? 0) * (e.tv_series.episode_run_time ?? 30)
    } else if (e.status === 'watching' || e.status === 'paused') {
      const totalEps      = e.tv_series.number_of_episodes ?? 0
      const seasons       = e.tv_series.number_of_seasons  ?? 1
      const avgEpsPerSzn  = seasons > 0 ? Math.ceil(totalEps / seasons) : totalEps
      const estimatedWatched = (e.current_season - 1) * avgEpsPerSzn + e.current_episode
      tvEpisodes += estimatedWatched
      tvMins     += estimatedWatched * (e.tv_series.episode_run_time ?? 30)
    }
  }

  // Ratings across BOTH movies and TV (previously movie-only, so a TV-only
  // library always showed avgMyRating: null even with ratings set).
  const ratedMovies = completed.filter(e => e.rating !== null)
    .map(e => ({ myRating: e.rating!, tmdbRating: e.movie.tmdb_rating }))
  const ratedTV = tv.filter(e => e.status === 'completed' && e.rating !== null)
    .map(e => ({ myRating: e.rating!, tmdbRating: e.tv_series.tmdb_rating }))
  const rated = [...ratedMovies, ...ratedTV]
  const tmdbRated = rated.filter(r => r.tmdbRating !== null)

  const avgMyRating   = rated.length     ? rated.reduce((s, r) => s + r.myRating, 0) / rated.length : null
  // Exclude null tmdb_rating entries instead of coalescing to 0, which pulled the average down.
  const avgTMDBRating = tmdbRated.length ? tmdbRated.reduce((s, r) => s + r.tmdbRating!, 0) / tmdbRated.length : null

  // Genre counts across all library entries
  const genreMap: Record<string, number> = {}
  for (const e of movies) {
    for (const g of (e.movie.genres ?? [])) genreMap[g.name] = (genreMap[g.name] ?? 0) + 1
  }
  for (const e of tv) {
    for (const g of (e.tv_series.genres ?? [])) genreMap[g.name] = (genreMap[g.name] ?? 0) + 1
  }
  const topGenres = Object.entries(genreMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }))

  return {
    moviesWatched:     completed.length,
    moviesWishlist:    movies.filter(e => e.status === 'wishlist').length,
    hoursWatched:      Math.round(movieMins / 60),
    tvSeriesTracked:   tv.length,
    tvEpisodesWatched: tvEpisodes,
    tvHoursWatched:    Math.round(tvMins / 60),
    avgMyRating:       avgMyRating   !== null ? Math.round(avgMyRating   * 10) / 10 : null,
    avgTMDBRating:     avgTMDBRating !== null ? Math.round(avgTMDBRating * 10) / 10 : null,
    topGenres,
  }
}
