// Media stats — pure (scripts/verify-year-review.cjs). One period at a time:
// a calendar year, or all time. Every figure keeps the rows behind it, so each
// number on screen opens the real titles and episodes it counts. A play is
// dated by its row's latest watch date (the app keeps one date per title /
// episode plus a play count, not a play history); Trakt's "unknown date"
// (before 1971, or none) never lands in a year, but all time counts it.

export interface ReviewMovie {
  tmdbId: number; title: string; poster: string | null; runtime: number | null; genres: string[]
  /** ISO; '' or before 1971 = watched on an unknown date. */
  watchedAt: string; plays: number
  rating?: number | null; tmdbRating?: number | null
}
export interface ReviewShow {
  tmdbId: number; title: string; poster: string | null; runtime: number | null; genres: string[]
  rating?: number | null; tmdbRating?: number | null
}
export interface ReviewEpisode { showId: string; season: number; episode: number; watchedAt: string; plays: number }

export interface ShowYear { show: ReviewShow; episodes: ReviewEpisode[]; plays: number; minutes: number }
export interface GenreYear { name: string; minutes: number; movies: ReviewMovie[]; shows: ReviewShow[] }
export interface MonthYear { month: number; minutes: number; movies: ReviewMovie[]; episodes: (ReviewEpisode & { show: ReviewShow })[] }
export interface YearBar { year: number; minutes: number; plays: number }
export interface Rewatch { type: 'movie' | 'episode'; title: string; tmdbId: number; poster: string | null; plays: number; label: string }
export interface WeekdayBar { day: number; plays: number; minutes: number }
export interface RatingStats {
  count: number
  mine: number | null
  tmdb: number | null
  /** Your ratings 1–10, index 0 = 1. */
  histogram: number[]
}

export interface YearReview {
  /** null = all time. */
  year: number | null
  minutes: number
  movies: ReviewMovie[]
  moviePlays: number
  shows: ShowYear[]
  episodeCount: number
  episodePlays: number
  genres: GenreYear[]
  /** A year: its twelve months. All time: empty months. */
  months: MonthYear[]
  /** All time: one bar per year with dated plays, oldest first. A year: []. */
  years: YearBar[]
  rewatches: Rewatch[]
  firstDate: string | null
  lastDate: string | null
  /** Monday = 0 … Sunday = 6, dated plays only. */
  weekdays: WeekdayBar[]
  activeDays: number
  busiestDay: { date: string; plays: number } | null
  longestStreak: { days: number; from: string; to: string } | null
  ratings: RatingStats
  /** Rows in this period without a known date (all time only; a year never has them). */
  undated: number
}

const DEFAULT_MOVIE_MIN = 100
const DEFAULT_EP_MIN = 40
export const isKnown = (iso: string) => !!iso && Date.parse(iso) >= Date.UTC(1971, 0, 1)
const yearOf = (iso: string) => new Date(iso).getFullYear()
const pad = (n: number) => String(n).padStart(2, '0')
/** The local calendar day of an instant, yyyy-MM-dd. */
const dayKey = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const nextDay = (key: string) => { const d = new Date(`${key}T12:00:00`); d.setDate(d.getDate() + 1); return dayKey(d.toISOString()) }

/** Years that have at least one dated watch, newest first. */
export function reviewYears(movies: ReviewMovie[], episodes: ReviewEpisode[]): number[] {
  const ys = new Set<number>()
  for (const m of movies) if (isKnown(m.watchedAt)) ys.add(yearOf(m.watchedAt))
  for (const e of episodes) if (isKnown(e.watchedAt)) ys.add(yearOf(e.watchedAt))
  return [...ys].sort((a, b) => b - a)
}

const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null)

export function ratingStats(movies: ReviewMovie[], shows: ReviewShow[]): RatingStats {
  const rated = [
    ...movies.filter(m => m.rating != null).map(m => ({ mine: m.rating!, tmdb: m.tmdbRating ?? null })),
    ...shows.filter(s => s.rating != null).map(s => ({ mine: s.rating!, tmdb: s.tmdbRating ?? null })),
  ]
  const histogram = Array.from({ length: 10 }, () => 0)
  for (const r of rated) histogram[Math.min(10, Math.max(1, Math.round(r.mine))) - 1]++
  const both = rated.filter((r): r is typeof r & { tmdb: number } => r.tmdb != null && r.tmdb > 0)
  return {
    count: rated.length,
    mine: avg(rated.map(r => r.mine)),
    tmdb: avg(both.map(r => r.tmdb)),
    histogram,
  }
}

/** One period's stats: a calendar year, or `null` for all time. */
export function buildYearReview(year: number | null, movies: ReviewMovie[], episodes: ReviewEpisode[], shows: Map<string, ReviewShow>): YearReview {
  const inPeriod = (iso: string) => (year == null ? true : isKnown(iso) && yearOf(iso) === year)
  const byDate = (a: { watchedAt: string }, b: { watchedAt: string }) => a.watchedAt.localeCompare(b.watchedAt)
  const ms = movies.filter(m => inPeriod(m.watchedAt)).sort(byDate)
  const es = episodes.filter(e => inPeriod(e.watchedAt) && shows.has(e.showId)).sort(byDate)

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
  const years = new Map<number, YearBar>()
  const dated = [
    ...ms.filter(m => isKnown(m.watchedAt)).map(m => ({ at: m.watchedAt, plays: m.plays, minutes: movieMin(m) })),
    ...es.filter(e => isKnown(e.watchedAt)).map(e => ({ at: e.watchedAt, plays: e.plays, minutes: epMin(e) })),
  ]
  if (year != null) {
    for (const m of ms) { const x = months[new Date(m.watchedAt).getMonth()]; x.minutes += movieMin(m); x.movies.push(m) }
    for (const e of es) { const x = months[new Date(e.watchedAt).getMonth()]; x.minutes += epMin(e); x.episodes.push({ ...e, show: shows.get(e.showId)! }) }
  } else {
    for (const d of dated) {
      const y = yearOf(d.at)
      const b = years.get(y) ?? { year: y, minutes: 0, plays: 0 }
      b.minutes += d.minutes; b.plays += d.plays
      years.set(y, b)
    }
  }

  // Habits, from dated plays only.
  const weekdays: WeekdayBar[] = Array.from({ length: 7 }, (_, day) => ({ day, plays: 0, minutes: 0 }))
  const perDay = new Map<string, number>()
  for (const d of dated) {
    const w = weekdays[(new Date(d.at).getDay() + 6) % 7]
    w.plays += d.plays; w.minutes += d.minutes
    const k = dayKey(d.at)
    perDay.set(k, (perDay.get(k) ?? 0) + d.plays)
  }
  let busiestDay: YearReview['busiestDay'] = null
  for (const [date, plays] of perDay) if (!busiestDay || plays > busiestDay.plays || (plays === busiestDay.plays && date > busiestDay.date)) busiestDay = { date, plays }
  let longestStreak: YearReview['longestStreak'] = null
  const days = [...perDay.keys()].sort()
  let from = days[0], prev = days[0], run = days.length ? 1 : 0
  const close = () => { if (run > 0 && (!longestStreak || run > longestStreak.days)) longestStreak = { days: run, from, to: prev } }
  for (const k of days.slice(1)) {
    if (k === nextDay(prev)) run++
    else { close(); from = k; run = 1 }
    prev = k
  }
  close()

  const rewatches: Rewatch[] = [
    ...ms.filter(m => m.plays > 1).map(m => ({ type: 'movie' as const, title: m.title, tmdbId: m.tmdbId, poster: m.poster, plays: m.plays, label: 'Movie' })),
    ...es.filter(e => e.plays > 1).map(e => {
      const s = shows.get(e.showId)!
      return { type: 'episode' as const, title: s.title, tmdbId: s.tmdbId, poster: s.poster, plays: e.plays, label: `S${e.season} · E${e.episode}` }
    }),
  ].sort((a, b) => b.plays - a.plays || a.title.localeCompare(b.title))

  const all = dated.map(d => d.at).sort()
  // Ratings: what this period's titles got; all time also counts rated shows without episode rows.
  const ratedShows = year == null ? [...shows.values()] : showYears.map(s => s.show)
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
    years: [...years.values()].sort((a, b) => a.year - b.year),
    rewatches: rewatches.slice(0, 20),
    firstDate: all[0] ?? null,
    lastDate: all[all.length - 1] ?? null,
    weekdays,
    activeDays: perDay.size,
    busiestDay,
    longestStreak,
    ratings: ratingStats(ms, ratedShows),
    undated: ms.filter(m => !isKnown(m.watchedAt)).length + es.filter(e => !isKnown(e.watchedAt)).length,
  }
}

/** Unknown-date rows the review can't place in any year. */
export function unknownDateCount(movies: ReviewMovie[], episodes: ReviewEpisode[]) {
  return movies.filter(m => !isKnown(m.watchedAt)).length + episodes.filter(e => !isKnown(e.watchedAt)).length
}
