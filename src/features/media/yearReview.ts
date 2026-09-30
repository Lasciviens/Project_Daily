// Year in review — pure (scripts/verify-year-review.cjs). Every figure keeps
// the rows behind it, so each number on screen opens the real titles and
// episodes it counts. A play is dated by its row's latest watch date (the app
// keeps one date per title / episode plus a play count, not a play history),
// and Trakt's "unknown date" (before 1971) never lands in a year.

export interface ReviewMovie { tmdbId: number; title: string; poster: string | null; runtime: number | null; genres: string[]; watchedAt: string; plays: number }
export interface ReviewShow { tmdbId: number; title: string; poster: string | null; runtime: number | null; genres: string[] }
export interface ReviewEpisode { showId: string; season: number; episode: number; watchedAt: string; plays: number }

export interface ShowYear { show: ReviewShow; episodes: ReviewEpisode[]; plays: number; minutes: number }
export interface GenreYear { name: string; minutes: number; movies: ReviewMovie[]; shows: ReviewShow[] }
export interface MonthYear { month: number; minutes: number; movies: ReviewMovie[]; episodes: (ReviewEpisode & { show: ReviewShow })[] }
export interface Rewatch { type: 'movie' | 'episode'; title: string; tmdbId: number; plays: number; label: string }

export interface YearReview {
  year: number
  minutes: number
  movies: ReviewMovie[]
  moviePlays: number
  shows: ShowYear[]
  episodeCount: number
  episodePlays: number
  genres: GenreYear[]
  months: MonthYear[]
  rewatches: Rewatch[]
  firstDate: string | null
  lastDate: string | null
}

const DEFAULT_MOVIE_MIN = 100
const DEFAULT_EP_MIN = 40
const isKnown = (iso: string) => !!iso && Date.parse(iso) >= Date.UTC(1971, 0, 1)
const yearOf = (iso: string) => new Date(iso).getFullYear()

/** Years that have at least one dated watch, newest first. */
export function reviewYears(movies: ReviewMovie[], episodes: ReviewEpisode[]): number[] {
  const ys = new Set<number>()
  for (const m of movies) if (isKnown(m.watchedAt)) ys.add(yearOf(m.watchedAt))
  for (const e of episodes) if (isKnown(e.watchedAt)) ys.add(yearOf(e.watchedAt))
  return [...ys].sort((a, b) => b - a)
}

export function buildYearReview(year: number, movies: ReviewMovie[], episodes: ReviewEpisode[], shows: Map<string, ReviewShow>): YearReview {
  const ms = movies.filter(m => isKnown(m.watchedAt) && yearOf(m.watchedAt) === year)
    .sort((a, b) => a.watchedAt.localeCompare(b.watchedAt))
  const es = episodes.filter(e => isKnown(e.watchedAt) && yearOf(e.watchedAt) === year && shows.has(e.showId))
    .sort((a, b) => a.watchedAt.localeCompare(b.watchedAt))

  const movieMin = (m: ReviewMovie) => (m.runtime || DEFAULT_MOVIE_MIN) * m.plays
  const epMin = (e: ReviewEpisode) => (shows.get(e.showId)!.runtime || DEFAULT_EP_MIN) * e.plays

  const byShow = new Map<string, ShowYear>()
  for (const e of es) {
    const s = byShow.get(e.showId) ?? { show: shows.get(e.showId)!, episodes: [], plays: 0, minutes: 0 }
    s.episodes.push(e); s.plays += e.plays; s.minutes += epMin(e)
    byShow.set(e.showId, s)
  }
  const showYears = [...byShow.values()].sort((a, b) => b.minutes - a.minutes || a.show.title.localeCompare(b.show.title))

  const genres = new Map<string, GenreYear>()
  const g = (name: string) => { const x = genres.get(name) ?? { name, minutes: 0, movies: [], shows: [] }; genres.set(name, x); return x }
  for (const m of ms) for (const name of m.genres) { const x = g(name); x.minutes += movieMin(m); x.movies.push(m) }
  for (const s of showYears) for (const name of s.show.genres) { const x = g(name); x.minutes += s.minutes; x.shows.push(s.show) }

  const months: MonthYear[] = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, minutes: 0, movies: [], episodes: [] }))
  for (const m of ms) { const x = months[new Date(m.watchedAt).getMonth()]; x.minutes += movieMin(m); x.movies.push(m) }
  for (const e of es) { const x = months[new Date(e.watchedAt).getMonth()]; x.minutes += epMin(e); x.episodes.push({ ...e, show: shows.get(e.showId)! }) }

  const rewatches: Rewatch[] = [
    ...ms.filter(m => m.plays > 1).map(m => ({ type: 'movie' as const, title: m.title, tmdbId: m.tmdbId, plays: m.plays, label: 'Movie' })),
    ...es.filter(e => e.plays > 1).map(e => {
      const s = shows.get(e.showId)!
      return { type: 'episode' as const, title: s.title, tmdbId: s.tmdbId, plays: e.plays, label: `S${e.season} · E${e.episode}` }
    }),
  ].sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title))

  const all = [...ms.map(m => m.watchedAt), ...es.map(e => e.watchedAt)].sort()
  return {
    year,
    minutes: ms.reduce((n, m) => n + movieMin(m), 0) + es.reduce((n, e) => n + epMin(e), 0),
    movies: ms,
    moviePlays: ms.reduce((n, m) => n + m.plays, 0),
    shows: showYears,
    episodeCount: es.length,
    episodePlays: es.reduce((n, e) => n + e.plays, 0),
    genres: [...genres.values()].sort((a, b) => b.minutes - a.minutes).slice(0, 8),
    months,
    rewatches: rewatches.slice(0, 20),
    firstDate: all[0] ?? null,
    lastDate: all[all.length - 1] ?? null,
  }
}

/** Unknown-date rows the review can't place in any year. */
export function unknownDateCount(movies: ReviewMovie[], episodes: ReviewEpisode[]) {
  return movies.filter(m => !isKnown(m.watchedAt)).length + episodes.filter(e => !isKnown(e.watchedAt)).length
}
