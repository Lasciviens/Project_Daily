#!/usr/bin/env node
/*
 * Verification — the automatic Trakt sync plan (docs/trakt/PLAN.md phase 3),
 * against the real traktSyncPlan.ts / traktDates.ts via sucrase: Trakt is
 * mirrored (additions AND removals), unsent app changes are left alone,
 * app-only states are never touched, a note keeps an entry, big removals
 * wait for a confirm, an unchanged library plans nothing, and Trakt's
 * "unknown date" (the epoch) becomes NULL on movies.
 */
require('sucrase/register')
const assert = require('node:assert/strict')
const {
  buildSyncPlan, itemKey, removalsNeedConfirm, showsNeedingInfoForSync, withoutRemovals, removalCount,
} = require('../src/features/media/trakt/traktSyncPlan')
const { isUnknownWatchedAt, movieWatchedAt, UNKNOWN_WATCHED_AT } = require('../src/features/media/trakt/traktDates')
const { buildImportPlan } = require('../src/features/media/trakt/traktImportPlan')

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
const AT = '2026-01-01T12:00:00.000Z'
const lm = (tmdbId, status = 'completed', o = {}) => ({ tmdbId, title: `M${tmdbId}`, year: 2020, status, repeatCount: 0, rating: null, watchedAt: status === 'completed' ? AT : null, watchlistRank: null, note: null, ...o })
const ls = (tmdbId, status = 'watching', o = {}) => ({ tmdbId, title: `S${tmdbId}`, year: 2019, status, rating: null, watchlistRank: null, note: null, ...o })
const le = (tmdbId, season, episode, repeatCount = 0) => ({ tmdbId, season, episode, repeatCount, watchedAt: AT })
const tm = (tmdb, plays = 1, at = AT) => ({ item: movie(tmdb), plays, lastWatchedAt: at })
const ts = (tmdb, episodes) => ({ item: show(tmdb), plays: episodes.length, lastWatchedAt: AT, resetAt: null, episodes })
const find = (xs, id) => xs.find(x => x.tmdbId === id)
const none = new Set()

// ── Unknown dates ────────────────────────────────────────────────────────────
ok(isUnknownWatchedAt(UNKNOWN_WATCHED_AT), true, 'epoch is Trakt\'s unknown date')
ok(isUnknownWatchedAt('1970-01-01T00:00:00Z'), true, 'epoch without millis too')
ok(isUnknownWatchedAt(AT), false, 'a real date is known')
ok(isUnknownWatchedAt(null), false, 'no date is not "unknown"')
ok(movieWatchedAt(UNKNOWN_WATCHED_AT), null, 'movie: unknown date is stored as NULL')
ok(movieWatchedAt(AT), AT, 'movie: real date kept')
{
  const p = buildImportPlan(snap({ watchedMovies: [tm(1, 1, UNKNOWN_WATCHED_AT)] }), lib(), new Map())
  ok(p.movies[0].watchedAt, null, 'import: an unknown-date movie gets NULL, not 01.01.1970')
}
{
  const p = buildSyncPlan(snap({ watchedMovies: [tm(1, 1, UNKNOWN_WATCHED_AT)] }), lib({ movies: [lm(1, 'completed', { watchedAt: null })] }), new Map(), none)
  ok(p.movies, [], 'sync: NULL here equals Trakt\'s unknown date — nothing to write')
}

// ── Nothing changed → nothing planned ────────────────────────────────────────
{
  const s = snap({
    watchedMovies: [tm(1, 2)],
    watchedShows: [ts(10, [[1, 1, 1, AT], [1, 2, 2, AT]])],
    watchlist: [{ item: movie(2), rank: 3, listedAt: null }],
    ratings: [{ item: movie(1), rating: 8, ratedAt: null }],
  })
  const l = lib({
    movies: [lm(1, 'completed', { repeatCount: 1, rating: 8 }), lm(2, 'wishlist', { watchlistRank: 3 })],
    shows: [ls(10, 'watching')],
    episodes: [le(10, 1, 1), le(10, 1, 2, 1)],
  })
  const p = buildSyncPlan(s, l, new Map([[10, { aired: 8 }]]), none)
  ok([p.movies.length, p.shows.length, p.episodes.length, removalCount(p)], [0, 0, 0, 0], 'in sync → empty plan')
  ok(showsNeedingInfoForSync(s, l, none), [], 'unchanged episode sets need no TMDB call')
}

// ── Additions from Trakt ─────────────────────────────────────────────────────
{
  const p = buildSyncPlan(snap({
    watchedMovies: [tm(1, 3)],
    watchedShows: [ts(10, [[1, 1, 1, AT], [1, 2, 1, AT], [1, 3, 1, AT]])],
    watchlist: [{ item: show(11), rank: 2, listedAt: null }],
  }), lib({ shows: [ls(10, 'watching')], episodes: [le(10, 1, 1), le(10, 1, 2)] }), new Map([[10, { aired: 3 }]]), none)
  ok(find(p.movies, 1).repeatCount, 2, 'new movie: plays − 1')
  ok(p.episodes, [{ tmdbId: 10, season: 1, episode: 3, repeatCount: 0, watchedAt: AT }], 'episode watched elsewhere comes in')
  ok(find(p.shows, 10).status, 'completed', 'last aired episode watched → Completed')
  ok(find(p.shows, 11).status, 'wishlist', 'new watchlist show → wishlist')
  ok(p.ids.map(i => `${i.type}:${i.ids.tmdb}`).sort(), ['movie:1', 'show:11'], 'only new titles need catalogue ids')
}
{
  const p = buildSyncPlan(snap({ watchedMovies: [tm(1, 3)] }), lib({ movies: [lm(1, 'completed')] }), new Map(), none)
  ok(find(p.movies, 1).repeatCount, 2, 'a rewatch logged on Trakt raises the play count here')
}

{
  const p = buildSyncPlan(snap({ watchedMovies: [tm(1, 2)] }), lib({ movies: [lm(1, 'watching', { repeatCount: 0, watchedAt: AT })] }), new Map(), none)
  ok([find(p.movies, 1).status, find(p.movies, 1).repeatCount], ['watching', 1], 'a rewatch in progress stays Watching; the plays follow Trakt')
}

// ── Removals on Trakt ────────────────────────────────────────────────────────
{
  const p = buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, AT]])] }),
    lib({ shows: [ls(10, 'completed')], episodes: [le(10, 1, 1), le(10, 1, 2)] }), new Map([[10, { aired: 2 }]]), none)
  ok(p.episodeDeletes, [{ tmdbId: 10, season: 1, episode: 2 }], 'a play removed on Trakt disappears here')
  ok(find(p.shows, 10).status, 'watching', 'and the show is no longer Completed')
}
{
  const p = buildSyncPlan(snap(), lib({ movies: [lm(1, 'completed'), lm(2, 'wishlist'), lm(3, 'completed', { note: 'great' })] }), new Map(), none)
  ok(p.movieDeletes.sort(), [1, 2], 'watched/wishlisted movies Trakt no longer has are removed')
  ok(p.kept, [itemKey.movie(3)], 'a note keeps the entry')
}
{
  const p = buildSyncPlan(snap({ watchlist: [{ item: movie(1), rank: 1, listedAt: null }] }), lib({ movies: [lm(1, 'completed', { repeatCount: 2 })] }), new Map(), none)
  const w = find(p.movies, 1)
  ok([w.status, w.repeatCount, w.watchedAt], ['wishlist', 0, null], 'history removed but still on the watchlist → Wishlist, plays cleared')
}
{
  const p = buildSyncPlan(snap({ ratings: [] }), lib({ movies: [lm(1, 'watching', { rating: 7 })] }), new Map(), none)
  ok(find(p.movies, 1).rating, null, 'a rating removed on Trakt is removed here')
  ok(find(p.movies, 1).status, 'watching', 'but the app-only Watching status stays')
}
{
  const p = buildSyncPlan(snap(), lib({ shows: [ls(10, 'dropped'), ls(11, 'wishlist'), ls(12, 'paused'), ls(13, 'watching')] }), new Map(), none)
  ok(p.showDeletes.sort(), [10, 11], 'dropped/wishlist shows Trakt no longer has are removed')
  ok(p.shows, [], 'paused and watching (app-only without episodes) are untouched')
}
{
  const p = buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, AT]])] }),
    lib({ shows: [ls(10, 'dropped')], episodes: [le(10, 1, 1)] }), new Map([[10, { aired: 5 }]]), none)
  ok(find(p.shows, 10).status, 'watching', 'undropped on Trakt → Watching again')
}
{
  const p = buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, AT]])], dropped: [{ item: show(10) }] }),
    lib({ shows: [ls(10, 'watching')], episodes: [le(10, 1, 1)] }), new Map(), none)
  ok(find(p.shows, 10).status, 'dropped', 'dropped on Trakt → Dropped here')
}
{
  const p = buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, AT]])] }),
    lib({ shows: [ls(10, 'paused')], episodes: [le(10, 1, 1)] }), new Map([[10, { aired: 9 }]]), none)
  ok(p.shows, [], 'Paused (app-only) survives a sync')
}

// ── Unsent app changes are left alone ────────────────────────────────────────
{
  const pending = new Set([itemKey.episode(10, 1, 2), itemKey.movie(1), itemKey.episode(10, 1, 3)])
  const p = buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, AT], [1, 3, 1, AT]])] }),
    lib({ movies: [lm(1, 'completed')], shows: [ls(10, 'watching')], episodes: [le(10, 1, 1), le(10, 1, 2)] }), new Map([[10, { aired: 3 }]]), pending)
  ok(p.movieDeletes, [], 'a movie marked watched here but not sent yet is not removed')
  ok(p.episodeDeletes, [], 'nor an episode waiting to be sent')
  ok(p.episodes, [], 'an episode unwatched here (removal waiting) is not re-added')
  ok(find(p.shows, 10)?.status ?? 'watching', 'watching', 'status counts the kept episodes, not the pending removal')
  ok(p.kept.sort(), [...pending].sort(), 'every held item is reported')
}
{
  const s = snap({ watchedShows: [] })
  const l = lib({ shows: [ls(10, 'watching')], episodes: [le(10, 1, 1)] })
  ok(showsNeedingInfoForSync(s, l, new Set([itemKey.episode(10, 1, 1)])), [10], 'a show kept only by a pending episode still gets its aired count')
}

// ── Big removals wait for a confirm ──────────────────────────────────────────
{
  const l = lib({ movies: Array.from({ length: 40 }, (_, i) => lm(i + 1, 'completed')) })
  const p = buildSyncPlan(snap(), l, new Map(), none)
  ok(removalCount(p), 40, 'an empty Trakt answer would remove everything…')
  ok(removalsNeedConfirm(p, l), true, '…so it waits for a confirm')
  ok(removalCount(withoutRemovals(p)), 0, 'and runs without removals meanwhile')
  const small = buildSyncPlan(snap({ watchedMovies: l.movies.slice(2).map(m => tm(m.tmdbId)) }), l, new Map(), none)
  ok([removalCount(small), removalsNeedConfirm(small, l)], [2, false], 'a couple of removals go through')
}

console.log(`verify-trakt-sync-plan: ${n} assertions passed`)
