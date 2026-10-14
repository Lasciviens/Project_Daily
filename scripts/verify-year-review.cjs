require('sucrase/register')
process.env.TZ = 'Europe/Oslo'
const assert = require('assert')
const { buildYearReview, reviewYears, unknownDateCount } = require('../src/features/media/yearReview.ts')
let n = 0
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
const movies = [
  { tmdbId: 1, title: 'A', poster: null, runtime: 120, genres: ['Drama'], watchedAt: '2026-02-10T20:00:00Z', plays: 2 },
  { tmdbId: 2, title: 'B', poster: null, runtime: null, genres: ['Comedy'], watchedAt: '2025-12-31T22:00:00Z', plays: 1 },
  { tmdbId: 3, title: 'C', poster: null, runtime: 90, genres: [], watchedAt: '1970-01-01T00:00:00Z', plays: 1 },
]
const shows = new Map([['s1', { tmdbId: 10, title: 'Show', poster: null, runtime: 50, genres: ['Drama'] }]])
const eps = [
  { showId: 's1', season: 1, episode: 1, watchedAt: '2026-03-01T20:00:00Z', plays: 1 },
  { showId: 's1', season: 1, episode: 2, watchedAt: '2026-03-02T20:00:00Z', plays: 3 },
  { showId: 's1', season: 1, episode: 3, watchedAt: '1970-01-01T00:00:00.000Z', plays: 1 },
  { showId: 'gone', season: 1, episode: 1, watchedAt: '2026-03-02T20:00:00Z', plays: 1 },
]
eq(reviewYears(movies, eps), [2026, 2025], 'years newest first, epoch excluded')
const r = buildYearReview(2026, movies, eps, shows)
eq(r.movies.map(m => m.title), ['A'], 'only this year')
eq(r.moviePlays, 2, 'movie plays')
eq(r.episodeCount, 2, 'episodes this year (unknown + unknown show excluded)')
eq(r.episodePlays, 4, 'episode plays')
eq(r.minutes, 240 + 50 * 4, 'minutes = runtime x plays')
eq(r.genres[0].name, 'Drama', 'top genre')
eq(r.genres[0].minutes, 440, 'genre minutes combine movies and shows')
eq(r.months[2].episodes.length, 2, 'March episodes')
eq(r.months[1].movies.length, 1, 'February movie')
eq(r.rewatches.map(x => x.plays), [3, 2], 'rewatches sorted by plays')
eq(r.rewatches.every(x => 'poster' in x), true, 'rewatch rows carry the title poster')
eq(r.shows[0].episodes.length, 2, 'show rows kept')
eq(unknownDateCount(movies, eps), 2, 'unknown dates counted')
const r25 = buildYearReview(2025, movies, eps, shows)
eq(r25.minutes, 100, 'default runtime when unknown')

// All time: every row (unknown dates too), one bar per dated year.
const all = buildYearReview(null, movies, eps, shows)
eq(all.year, null, 'all time has no year')
eq(all.movies.length, 3, 'all time keeps films watched on an unknown date')
eq(all.episodeCount, 3, 'all time keeps unknown-date episodes (not ones of a removed show)')
eq(all.undated, 2, 'undated rows counted in all time')
eq(all.years.map(y => y.year), [2025, 2026], 'one bar per dated year, oldest first')
eq(all.years.map(y => y.minutes), [100, 440], 'year bars sum runtime x plays')
eq(all.minutes, 240 + 100 + 90 + 50 * 5, 'all time minutes include undated plays')
eq(r.years, [], 'a year has month bars, not year bars')
eq(r.undated, 0, 'a year never holds undated rows')
// Habits (Oslo days; Monday = 0).
eq(r.activeDays, 3, 'three days with a dated play in 2026')
eq(r.weekdays.map(w => w.plays), [3, 2, 0, 0, 0, 0, 1], 'Mon 02.03 (3) · Tue 10.02 (2) · Sun 01.03 (1)')
eq(r.busiestDay, { date: '2026-03-02', plays: 3 }, 'busiest local day')
eq(r.longestStreak, { days: 2, from: '2026-03-01', to: '2026-03-02' }, 'two days in a row')
// Ratings: yours vs TMDB on the same titles, and where you differ.
const rated = [
  { tmdbId: 7, title: 'Loved', poster: null, runtime: 100, genres: [], watchedAt: '2026-05-01T20:00:00Z', plays: 1, rating: 9, tmdbRating: 6.4 },
  { tmdbId: 8, title: 'Meh', poster: null, runtime: 100, genres: [], watchedAt: '2026-05-02T20:00:00Z', plays: 1, rating: 7, tmdbRating: 7.2 },
  { tmdbId: 9, title: 'Unrated', poster: null, runtime: 100, genres: [], watchedAt: '2026-05-03T20:00:00Z', plays: 1, rating: null, tmdbRating: 8 },
]
const rr = buildYearReview(2026, rated, [], new Map())
eq([rr.ratings.count, rr.ratings.mine, rr.ratings.tmdb], [2, 8, 6.8], 'averages over rated titles only')
eq(rr.ratings.histogram[8] + rr.ratings.histogram[6], 2, 'a 9 and a 7 in the spread')
eq('disagreements' in rr.ratings, false, 'no disagreement list (removed on request)')

// Every watch on its own date (migration 149): a film seen in 2018 and twice in 2026.
{
  const twice = [{ tmdbId: 20, title: 'Again', poster: null, runtime: 100, genres: ['Drama'], watchedAt: '2026-04-01T20:00:00Z', plays: 3,
    watches: ['2018-10-12T20:00:00Z', '2026-01-05T20:00:00Z', '2026-04-01T20:00:00Z'] }]
  const got = [{ showId: 's1', season: 1, episode: 1, watchedAt: '2026-01-08T20:00:00Z', plays: 3,
    watches: ['2018-10-12T20:00:00Z', '2024-12-01T20:00:00Z', '1970-01-01T00:00:00Z'] }]
  eq(reviewYears(twice, got), [2026, 2024, 2018], 'each watch makes its own year')
  const y18 = buildYearReview(2018, twice, got, shows)
  eq([y18.moviePlays, y18.episodePlays, y18.minutes], [1, 1, 150], '2018: the first watch of each, one play each')
  eq(y18.movies[0].watchedAt, '2018-10-12T20:00:00Z', 'dated by the watch in that year')
  const y26 = buildYearReview(2026, twice, got, shows)
  eq([y26.moviePlays, y26.rewatches.length, y26.episodePlays], [2, 1, 0], '2026: two plays of the film (a rewatch), the episode has no 2026 watch')
  eq([y26.months[0].minutes, y26.months[3].minutes, y26.months[0].movies.length], [100, 100, 1], 'each watch in its own month')
  eq(y26.activeDays, 2, 'two days with a watch')
  const all = buildYearReview(null, twice, got, shows)
  eq([all.moviePlays, all.episodePlays, all.undated], [3, 3, 1], 'all time: every watch, one on an unknown date')
  eq(all.years.map(y => [y.year, y.plays]), [[2018, 2], [2024, 1], [2026, 2]], 'one bar per year, each watch in its own')
  eq(unknownDateCount(twice, got), 1, 'plays on an unknown date are counted one by one')
}
console.log(`verify-year-review: ${n} assertions passed`)
