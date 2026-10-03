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
  buildSyncPlan, removalsNeedConfirm, showsNeedingInfoForSync, withoutRemovals, removalCount, lastActivitiesChange,
} = require('../src/features/media/trakt/traktSyncPlan')
const { isUnknownWatchedAt, movieWatchedAt, UNKNOWN_WATCHED_AT } = require('../src/features/media/trakt/traktDates')
const { buildImportPlan, itemKey } = require('../src/features/media/trakt/traktImportPlan')

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
  ok([find(p.movies, 1).status, find(p.movies, 1).repeatCount], ['completed', 1], 'plays on Trakt → Completed; the plays follow Trakt')
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
  ok(p.showDeletes.sort(), [11], 'a wishlist show Trakt no longer has is removed')
  ok(p.shows, [], 'dropped, paused and watching (app-only) are untouched')
}
{
  const p = buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, AT]])] }),
    lib({ shows: [ls(10, 'dropped')], episodes: [le(10, 1, 1)] }), new Map([[10, { aired: 5 }]]), none)
  ok(p.shows, [], 'Dropped here but not on Trakt\'s dropped list (e.g. not_found) stays Dropped')
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

// ── Audit fixes ──────────────────────────────────────────────────────────────
{
  const p = buildSyncPlan(snap({ watchedMovies: [tm(1, 2)] }), lib({ movies: [lm(1, 'dropped', { watchedAt: null })] }), new Map(), none)
  ok(find(p.movies, 1).status, 'dropped', 'a Dropped movie with plays on Trakt stays Dropped')
}
{
  const p = buildSyncPlan(snap(), lib({ movies: [lm(1, 'upcoming', { watchedAt: null })] }), new Map(), none)
  ok([p.movieDeletes, p.movies], [[], []], 'an Upcoming movie Trakt does not list (watchlist_add not_found) is not deleted')
}
{
  const p = buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, '2025-03-03T10:00:00.000Z'], [1, 2, 1, null]])] }),
    lib({ shows: [ls(10, 'watching')], episodes: [le(10, 1, 1), le(10, 1, 2)] }), new Map(), none)
  ok(p.episodes, [{ tmdbId: 10, season: 1, episode: 1, repeatCount: 0, watchedAt: '2025-03-03T10:00:00.000Z' }], 'a date changed on Trakt (same plays) is updated; no date on Trakt changes nothing')
}
{
  // Watched show, no seasons in Trakt's answer: nothing deleted, status kept.
  const s = snap({ watchedShows: [{ item: show(10), plays: 4, lastWatchedAt: AT, resetAt: null, episodes: [] }] })
  const l = lib({ shows: [ls(10, 'completed')], episodes: [le(10, 1, 1), le(10, 1, 2)] })
  const p = buildSyncPlan(s, l, new Map([[10, { aired: 9 }]]), none)
  ok(p.episodeDeletes, [], 'missing seasons are unknown, never "no episodes"')
  ok(p.shows, [], 'and the show keeps its status')
  ok(showsNeedingInfoForSync(s, l, none), [], 'and needs no aired count')
}
{
  // Half-watched on Trakt (Continue watching)
  const pb = (item, progress = 40) => ({ item, season: item.type === 'show' ? 1 : null, episode: item.type === 'show' ? 3 : null, progress, pausedAt: null })
  const p = buildSyncPlan(snap({ playback: [pb(movie(1)), pb(movie(2)), pb(show(10)), pb(show(11))] }),
    lib({ movies: [lm(2, 'wishlist', { watchedAt: null })], shows: [ls(11, 'wishlist')] }), new Map(), none)
  ok(find(p.movies, 1).status, 'watching', 'a half-watched movie not here comes in as Watching')
  ok(find(p.movies, 2).status, 'watching', 'a wishlisted movie half-watched on Trakt → Watching')
  ok(find(p.shows, 10).status, 'watching', 'a show with only a paused episode and no entry → Watching')
  ok(find(p.shows, 11), undefined, 'a show already here is not changed by a paused episode')
  ok(p.ids.map(i => `${i.type}:${i.ids.tmdb}`).sort(), ['movie:1', 'show:10'], 'new half-watched titles get catalogue ids')
  const later = buildSyncPlan(snap(), lib({ movies: [lm(1, 'watching', { watchedAt: null })] }), new Map(), none)
  ok([later.movieDeletes, later.movies], [[], []], 'once Continue watching drops it, the Watching movie stays (never deleted)')
  const done = buildSyncPlan(snap({ watchedMovies: [tm(1, 1)] }), lib({ movies: [lm(1, 'watching', { watchedAt: null })] }), new Map(), none)
  ok(find(done.movies, 1).status, 'completed', 'a full play on Trakt later moves it to Completed')
}
{
  // Held-back removals never move a show's status.
  const l = lib({ shows: [ls(10, 'completed', { rating: 5 })], episodes: Array.from({ length: 30 }, (_, i) => le(10, 1, i + 1)) })
  const s = snap({ watchedShows: [ts(10, [[1, 1, 1, AT]])], ratings: [{ item: show(10), rating: 9, ratedAt: null }] })
  const p = buildSyncPlan(s, l, new Map([[10, { aired: 30 }]]), none)
  ok(find(p.shows, 10).status, 'watching', 'with the removals the show would drop to Watching…')
  ok(removalsNeedConfirm(p, l), true, '…but 29 removals wait for a confirm')
  const held = withoutRemovals(p)
  ok(find(held.shows, 10), { tmdbId: 10, item: show(10), status: 'completed', rating: 9, watchlistRank: null }, 'held back: status stays Completed, the rating still follows Trakt')
  const l2 = lib({ shows: [ls(10, 'completed')], episodes: l.episodes })
  ok(withoutRemovals(buildSyncPlan(snap({ watchedShows: [ts(10, [[1, 1, 1, AT]])] }), l2, new Map([[10, { aired: 30 }]]), none)).shows, [], 'held back with nothing else changed → no show write')
}
{
  const prev = { all: '2026-09-01T00:00:00.000Z', shows: { reset_at: null } }
  ok(lastActivitiesChange(prev, { ...prev }), { changed: false, reset: false }, 'same last_activities → nothing changed')
  ok(lastActivitiesChange(prev, { ...prev, all: '2026-09-02T00:00:00.000Z' }), { changed: true, reset: false }, 'all moved → changed')
  ok(lastActivitiesChange(prev, { ...prev, shows: { reset_at: '2026-09-02T00:00:00.000Z' } }), { changed: true, reset: true }, 'a reset_at moved → full mirror even when all did not')
  ok(lastActivitiesChange(null, prev).changed, true, 'no previous state → changed')
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
