// Media stats — pure (scripts/verify-year-review.cjs). One period at a time:
// a calendar year, or all time. Every figure keeps the rows behind it, so each
// number on screen opens the real titles and episodes it counts. Every watch
// counts on its own date (`watches`, migration 149): a film first seen in 2018
// and again in 2026 is a 2018 play and a 2026 play. Rows without a watch list
// (before 149) count `plays` at their one date. Trakt's "unknown date"
// (before 1971, or none) never lands in a year, but all time counts it.

export interface ReviewMovie {
  tmdbId: number; title: string; poster: string | null; runtime: number | null; genres: string[]
  /** ISO; '' or before 1971 = watched on an unknown date. In a period: its latest watch there. */
  watchedAt: string; plays: number
  /** Each watch's own date (migration 149); in a period, only the ones in it. */
  watches?: string[]
  rating?: number | null; tmdbRating?: number | null
}
export interface ReviewShow {
  tmdbId: number; title: string; poster: string | null; runtime: number | null; genres: string[]
  rating?: number | null; tmdbRating?: number | null
}
export interface ReviewEpisode {
  showId: string; season: number; episode: number; watchedAt: string; plays: number
  /** Each watch's own date (migration 149); in a period, only the ones in it. */
  watches?: string[]
}

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

/** Every watch's date: its own (149), else `plays` times the row's one date. */
export const watchDatesOf = (x: { watchedAt: string; plays: number; watches?: string[] }): string[] =>
  x.watches?.length ? x.watches : Array.from({ length: Math.max(1, x.plays) }, () => x.watchedAt)

/** Whether a row has a watch on an unknown date. */
export const hasUnknownWatch = (x: { watchedAt: string; plays: number; watches?: string[] }) => watchDatesOf(x).some(d => !isKnown(d))

/** A row narrowed to the watches in a period (null = none there): plays and latest date follow. */
function inPeriodOf<T extends { watchedAt: string; plays: number; watches?: string[] }>(x: T, inPeriod: (iso: string) => boolean): T | null {
  const d = watchDatesOf(x).filter(inPeriod)
  if (!d.length) return null
  const known = d.filter(isKnown).sort()
  return { ...x, plays: d.length, watches: d, watchedAt: known[known.length - 1] ?? d[0] }
}

/** One dated watch, with its estimated length — Personal's Watching card. */
export interface DayWatch {
  kind: 'movie' | 'episode'
  /** ISO: the watch's own moment. */
  at: string
  /** Its local day, yyyy-MM-dd. */
  day: string
  /** The year review's runtime rule: the film's runtime, else 100 min; the show's episode run time, else 40. */
  minutes: number
  title: string
  tmdbId: number
  poster: string | null
  season?: number
  episode?: number
}

/** Every dated watch on the local days from → to (inclusive), newest first
 *  (one moment: the higher season and episode first). A watch on an unknown
 *  date never counts. */
export function watchesBetween(from: string, to: string, movies: ReviewMovie[], episodes: ReviewEpisode[], shows: Map<string, ReviewShow>): DayWatch[] {
  const out: DayWatch[] = []
  const dayIn = (iso: string) => { if (!isKnown(iso)) return null; const d = dayKey(iso); return d >= from && d <= to ? d : null }
  for (const m of movies) {
    for (const at of watchDatesOf(m)) {
      const day = dayIn(at)
      if (day) out.push({ kind: 'movie', at, day, minutes: m.runtime || DEFAULT_MOVIE_MIN, title: m.title, tmdbId: m.tmdbId, poster: m.poster })
    }
  }
  for (const e of episodes) {
    const s = shows.get(e.showId)
    if (!s) continue
    for (const at of watchDatesOf(e)) {
      const day = dayIn(at)
      if (day) out.push({ kind: 'episode', at, day, minutes: s.runtime || DEFAULT_EP_MIN, title: s.title, tmdbId: s.tmdbId, poster: s.poster, season: e.season, episode: e.episode })
    }
  }
  return out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (b.season ?? 0) - (a.season ?? 0) || (b.episode ?? 0) - (a.episode ?? 0))
}

/** Years that have at least one dated watch, newest first. */
export function reviewYears(movies: ReviewMovie[], episodes: ReviewEpisode[]): number[] {
  const ys = new Set<number>()
  for (const x of [...movies, ...episodes]) for (const d of watchDatesOf(x)) if (isKnown(d)) ys.add(yearOf(d))
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
  const ms = movies.map(m => inPeriodOf(m, inPeriod)).filter((m): m is ReviewMovie => !!m).sort(byDate)
  const es = episodes.filter(e => shows.has(e.showId)).map(e => inPeriodOf(e, inPeriod)).filter((e): e is ReviewEpisode => !!e).sort(byDate)

  const movieRun = (m: ReviewMovie) => m.runtime || DEFAULT_MOVIE_MIN
  const epRun = (e: ReviewEpisode) => shows.get(e.showId)!.runtime || DEFAULT_EP_MIN
  const movieMin = (m: ReviewMovie) => movieRun(m) * m.plays
  const epMin = (e: ReviewEpisode) => epRun(e) * e.plays

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
  // One entry per dated watch: each lands on its own day.
  const dated = [
    ...ms.flatMap(m => watchDatesOf(m).filter(isKnown).map(at => ({ at, plays: 1, minutes: movieRun(m) }))),
    ...es.flatMap(e => watchDatesOf(e).filter(isKnown).map(at => ({ at, plays: 1, minutes: epRun(e) }))),
  ]
  if (year != null) {
    // A title watched in two months is in both, with the minutes of each watch.
    for (const m of ms) {
      const seen = new Set<number>()
      for (const at of watchDatesOf(m)) {
        const x = months[new Date(at).getMonth()]
        x.minutes += movieRun(m)
        if (!seen.has(x.month)) { seen.add(x.month); x.movies.push(m) }
      }
    }
    for (const e of es) {
      const seen = new Set<number>()
      for (const at of watchDatesOf(e)) {
        const x = months[new Date(at).getMonth()]
        x.minutes += epRun(e)
        if (!seen.has(x.month)) { seen.add(x.month); x.episodes.push({ ...e, show: shows.get(e.showId)! }) }
      }
    }
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
    undated: [...ms, ...es].reduce((n, x) => n + watchDatesOf(x).filter(d => !isKnown(d)).length, 0),
  }
}

/** Plays on an unknown date: the review can't place them in any year. */
export function unknownDateCount(movies: ReviewMovie[], episodes: ReviewEpisode[]) {
  return [...movies, ...episodes].reduce((n, x) => n + watchDatesOf(x).filter(d => !isKnown(d)).length, 0)
}
