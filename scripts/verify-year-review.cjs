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
eq(r.shows[0].episodes.length, 2, 'show rows kept')
eq(unknownDateCount(movies, eps), 2, 'unknown dates counted')
const r25 = buildYearReview(2025, movies, eps, shows)
eq(r25.minutes, 100, 'default runtime when unknown')
console.log(`verify-year-review: ${n} assertions passed`)
