#!/usr/bin/env node
/*
 * Verification — the Trakt import plan (docs/trakt/PLAN.md phase 2), against
 * the real traktImportPlan.ts via sucrase: Trakt wins, app-only facts are
 * pushed, watched/watching beats wishlist on both sides, plays = 1 + repeat,
 * Completed vs Watching from aired episodes, and a second run plans nothing.
 */
require('sucrase/register')
const assert = require('node:assert/strict')
const { buildImportPlan, airedEpisodes, pushCount, showsNeedingInfo } = require('../src/features/media/trakt/traktImportPlan')

let n = 0
const ok = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); n++ }

const ids = tmdb => ({ trakt: tmdb + 1000, slug: null, tmdb, imdb: null, tvdb: null })
const movie = tmdb => ({ type: 'movie', ids: ids(tmdb), title: `M${tmdb}`, year: 2020 })
const show = tmdb => ({ type: 'show', ids: ids(tmdb), title: `S${tmdb}`, year: 2019 })
const snap = (o = {}) => ({
  fetchedAt: '2026-09-30T10:00:00.000Z', username: 'u', lastActivities: {},
  watchedMovies: [], watchedShows: [], watchlist: [], ratings: [], favorites: [], dropped: [], playback: [], ...o,
})
const lib = (o = {}) => ({ movies: [], shows: [], episodes: [], ...o })
const lm = (tmdbId, status = 'completed', repeatCount = 0, rating = null, watchedAt = '2026-01-01T12:00:00.000Z') =>
  ({ tmdbId, title: `M${tmdbId}`, year: 2020, status, repeatCount, rating, watchedAt })
const ls = (tmdbId, status = 'watching', rating = null) => ({ tmdbId, title: `S${tmdbId}`, year: 2019, status, rating })
const le = (tmdbId, season, episode, repeatCount = 0) => ({ tmdbId, season, episode, repeatCount, watchedAt: '2026-02-01T12:00:00.000Z' })
const find = (xs, id) => xs.find(x => x.tmdbId === id)

// Movies
{
  const p = buildImportPlan(snap({
    watchedMovies: [{ item: movie(1), plays: 3, lastWatchedAt: '2025-05-05T00:00:00.000Z' }],
    watchlist: [{ item: movie(2), rank: 4, listedAt: null }, { item: movie(3), rank: 1, listedAt: null }],
    ratings: [{ item: movie(1), rating: 9, ratedAt: null }],
  }), lib({ movies: [lm(3, 'completed'), lm(4, 'completed', 1, 7), lm(5, 'wishlist'), lm(6, 'dropped')] }), new Map())
  ok(find(p.movies, 1), { tmdbId: 1, item: movie(1), status: 'completed', repeatCount: 2, watchedAt: '2025-05-05T00:00:00.000Z', rating: 9, watchlistRank: null }, 'Trakt movie comes in completed with plays − 1')
  ok(find(p.movies, 2).status, 'wishlist', 'watchlist movie → wishlist')
  ok(find(p.movies, 2).watchlistRank, 4, 'watchlist rank kept')
  ok(find(p.movies, 3).status, 'completed', 'watched here beats the Trakt watchlist')
  ok(p.push.watchlistRemove.movies, [{ tmdb: 3 }], 'watched movie leaves the Trakt watchlist')
  ok(p.push.history.movies.filter(m => m.tmdb === 4).length, 2, 'two plays here → two history entries')
  ok(new Set(p.push.history.movies.filter(m => m.tmdb === 4).map(m => m.watchedAt)).size, 2, 'each play gets its own time')
  ok(p.push.history.movies.some(m => m.tmdb === 3), true, 'watched only here → sent to history')
  ok(p.push.ratings.movies, [{ tmdb: 4, rating: 7 }], 'rating only here → sent')
  ok(p.push.watchlistAdd.movies, [{ tmdb: 5 }], 'wishlist only here → Trakt watchlist')
  ok(find(p.movies, 6).status, 'dropped', 'a dropped movie (app-only state) is kept')
}

// Shows
{
  const s = snap({
    watchedShows: [
      { item: show(10), plays: 2, lastWatchedAt: '2025-01-01T00:00:00.000Z', resetAt: null, episodes: [[1, 1, 1, '2025-01-01T00:00:00.000Z'], [1, 2, 2, '2025-01-02T00:00:00.000Z']] },
      { item: show(11), plays: 1, lastWatchedAt: null, resetAt: null, episodes: [[1, 1, 1, null]] },
    ],
    watchlist: [{ item: show(11), rank: 2, listedAt: null }],
    ratings: [{ item: show(10), rating: 8, ratedAt: null }],
  })
  const local = lib({
    shows: [ls(12, 'wishlist'), ls(13, 'paused'), ls(14, 'wishlist', 6)],
    episodes: [le(12, 1, 1), le(13, 1, 1), le(10, 1, 1), le(10, 2, 1, 1)],
  })
  const info = new Map([[10, { aired: 3 }], [11, { aired: 10 }], [13, { aired: 5 }]])
  const p = buildImportPlan(s, local, info)
  ok(find(p.shows, 10).status, 'completed', 'every aired episode watched (Trakt + here) → Completed')
  ok(find(p.shows, 10).rating, 8, 'show rating from Trakt')
  ok(find(p.shows, 11).status, 'watching', 'watched episodes beat the Trakt watchlist')
  ok(p.push.watchlistRemove.shows, [{ tmdb: 11 }], 'watching show leaves the Trakt watchlist')
  ok(find(p.shows, 12).status, 'watching', 'wishlist here with watched episodes → Watching (Spider-Noir)')
  ok(p.push.watchlistAdd.shows.some(x => x.tmdb === 12), false, 'a watched show is never sent to the watchlist')
  ok(find(p.shows, 13).status, 'paused', 'Paused is kept')
  ok(find(p.shows, 14).status, 'wishlist', 'unwatched wishlist stays')
  ok(p.push.watchlistAdd.shows, [{ tmdb: 14 }], 'unwatched wishlist is sent to the Trakt watchlist')
  ok(p.push.ratings.shows, [{ tmdb: 14, rating: 6 }], 'show rating only here → sent')
  ok(p.episodes.filter(e => e.tmdbId === 10).map(e => `${e.season}x${e.episode}:${e.repeatCount}`), ['1x2:1'], 'only new or changed episodes are written')
  ok(p.push.history.episodes.filter(e => e.tmdb === 10).length, 2, 'an episode watched twice only here → two plays sent')
  ok(p.push.history.episodes.some(e => e.tmdb === 12), true, 'episodes only here → sent')
  ok(showsNeedingInfo(s, local).sort((a, b) => a - b), [10, 11, 12, 13], 'shows with any watched episode need TMDB details')
}

// Dropped here, not on Trakt → Trakt's dropped list; already dropped there → nothing
{
  const p = buildImportPlan(snap({ dropped: [{ item: show(31) }] }), lib({ shows: [ls(30, 'dropped'), ls(31, 'dropped')] }), new Map())
  ok(p.push.droppedAdd.shows, [{ tmdb: 30 }], 'a show dropped only here is sent to Trakt\'s dropped list')
  ok(find(p.shows, 30).status, 'dropped', 'it stays dropped here')
}

// No TMDB details: never guessed Completed
{
  const p = buildImportPlan(snap({ watchedShows: [{ item: show(20), plays: 1, lastWatchedAt: null, resetAt: null, episodes: [[1, 1, 1, null]] }] }), lib(), new Map())
  ok(find(p.shows, 20).status, 'watching', 'unknown aired count → Watching')
  const done = buildImportPlan(snap({ watchedShows: [{ item: show(21), plays: 1, lastWatchedAt: null, resetAt: null, episodes: [[1, 1, 1, null]] }] }),
    lib({ shows: [ls(21, 'completed')], episodes: [le(21, 1, 1)] }), new Map())
  ok(find(done.shows, 21)?.status ?? 'completed', 'completed', 'unknown aired count never demotes a Completed show to Watching')
}

// A second run after the import plans nothing new
{
  const s = snap({
    watchedMovies: [{ item: movie(1), plays: 2, lastWatchedAt: '2025-05-05T00:00:00.000Z' }, { item: movie(4), plays: 1, lastWatchedAt: null }],
    watchedShows: [{ item: show(10), plays: 2, lastWatchedAt: null, resetAt: null, episodes: [[1, 1, 1, null], [1, 2, 1, null]] }],
    watchlist: [{ item: movie(5), rank: 1, listedAt: null }],
    ratings: [{ item: movie(1), rating: 9, ratedAt: null }],
  })
  const local = lib({
    movies: [lm(1, 'completed', 1, 9), lm(4, 'completed'), lm(5, 'wishlist')],
    shows: [ls(10, 'completed')],
    episodes: [le(10, 1, 1), le(10, 1, 2)],
  })
  const p = buildImportPlan(s, local, new Map([[10, { aired: 2 }]]))
  ok(pushCount(p.push), 0, 'nothing to send once both sides match')
  ok(p.episodes.length, 0, 'no episode writes once both sides match')
}

// Aired episodes from TMDB details
ok(airedEpisodes({ seasons: [{ season_number: 0, episode_count: 5 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 8 }], last_episode_to_air: { season_number: 2, episode_number: 3 } }), 13, 'specials excluded, current season counted to the last aired')
ok(airedEpisodes({ seasons: [{ season_number: 1, episode_count: 10 }], last_episode_to_air: null }), 0, 'nothing aired → 0')

console.log(`verify-trakt-import-plan: ${n} assertions passed`)
