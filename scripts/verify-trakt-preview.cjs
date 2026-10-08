#!/usr/bin/env node
/*
 * Verification — the Trakt first-import preview (docs/trakt/PLAN.md), against
 * the real traktPreview.ts via sucrase. Covers: matching by TMDB id only,
 * plays = 1 + repeat_count, Trakt-wins changes, app-only facts listed as
 * "send to Trakt", watchlist vs already-watched, no-TMDB items unmatched,
 * local duplicate detection, and notes (the import's three-way note plan).
 */
require('sucrase/register')
const assert = require('node:assert/strict')
const { buildTraktPreview, previewReport } = require('../src/features/media/trakt/traktPreview')

let n = 0
const ok = (actual, expected, msg) => { assert.deepStrictEqual(actual, expected, msg); n++ }

const ids = (tmdb, trakt = tmdb + 1000) => ({ trakt, slug: null, tmdb, imdb: null, tvdb: null })
const movie = (tmdb, t = `M${tmdb}`) => ({ type: 'movie', ids: ids(tmdb), title: t, year: 2020 })
const show = (tmdb, t = `S${tmdb}`) => ({ type: 'show', ids: ids(tmdb), title: t, year: 2019 })
const snap = (o = {}) => ({
  fetchedAt: '2026-09-30T10:00:00Z', username: 'u', lastActivities: {},
  watchedMovies: [], watchedShows: [], watchlist: [], ratings: [], favorites: [], dropped: [], playback: [], ...o,
})
const lib = (o = {}) => ({ movies: [], shows: [], episodes: [], ...o })
const lm = (tmdbId, status = 'completed', repeatCount = 0, rating = null) => ({ tmdbId, title: `M${tmdbId}`, year: 2020, status, repeatCount, rating })
const ls = (tmdbId, status = 'watching', rating = null) => ({ tmdbId, title: `S${tmdbId}`, year: 2019, status, rating })

// Movies
{
  const p = buildTraktPreview(snap({ watchedMovies: [
    { item: movie(1), plays: 1, lastWatchedAt: null },
    { item: movie(2), plays: 3, lastWatchedAt: null },
    { item: movie(3), plays: 1, lastWatchedAt: null },
  ] }), lib({ movies: [lm(1), lm(2, 'completed', 0), lm(3, 'wishlist'), lm(4)] }))
  ok(p.movies.same, 1, 'same TMDB id, completed, 1 play = same')
  ok(p.movies.update.map(u => u.detail), ['plays 1 → 3', 'wishlist → completed'], 'Trakt wins for plays and status')
  ok(p.movies.add.length, 0, 'nothing new when every Trakt movie is already here')
  ok(p.movies.push.map(t => t.tmdbId), [4], 'completed here, not on Trakt → sent to Trakt')
  ok(buildTraktPreview(snap({ watchedMovies: [{ item: movie(9), plays: 2, lastWatchedAt: null }] }), lib()).movies.add.length, 1, 'unknown title → added')
  ok(buildTraktPreview(snap({ watchedMovies: [{ item: movie(1), plays: 2, lastWatchedAt: null }] }), lib({ movies: [lm(1, 'completed', 1)] })).movies.same, 1, 'repeat_count 1 = 2 plays')
}

// Shows + episodes
{
  const p = buildTraktPreview(snap({ watchedShows: [
    { item: show(10), plays: 3, lastWatchedAt: null, resetAt: null, episodes: [[1, 1, 1, null], [1, 2, 2, null], [1, 3, 1, null]] },
    { item: show(11), plays: 1, lastWatchedAt: null, resetAt: null, episodes: [[1, 1, 1, null]] },
  ] }), lib({
    shows: [ls(10), ls(12)],
    episodes: [
      { tmdbId: 10, season: 1, episode: 1, repeatCount: 0 },
      { tmdbId: 10, season: 1, episode: 2, repeatCount: 0 },
      { tmdbId: 10, season: 2, episode: 1, repeatCount: 0 },
      { tmdbId: 12, season: 1, episode: 1, repeatCount: 0 },
    ],
  }))
  ok(p.episodes.same, 1, 'S1E1 same')
  ok(p.episodes.playsChanged, 1, 'S1E2 plays 1 → 2')
  ok(p.episodes.add, 2, 'S1E3 of show 10 and S1E1 of the new show 11')
  ok(p.episodes.push, 2, 'S2E1 only here, plus show 12 not on Trakt')
  ok(p.shows.add.map(t => t.tmdbId), [11], 'show 11 is new')
  ok(p.shows.update.map(t => t.detail), ['1 episode to add'], 'show 10 gains one episode')
  ok(p.shows.push.map(t => t.tmdbId), [12], 'show 12 watched here only')
}

// Watchlist, ratings, dropped
{
  const p = buildTraktPreview(snap({
    watchlist: [{ item: movie(1), rank: 1, listedAt: null }, { item: movie(2), rank: 2, listedAt: null }, { item: show(20), rank: 3, listedAt: null }],
    ratings: [{ item: movie(1), rating: 8, ratedAt: null }, { item: show(20), rating: 7, ratedAt: null }],
    dropped: [{ item: show(21) }, { item: show(22) }],
  }), lib({
    movies: [lm(1, 'wishlist', 0, 6), lm(2, 'completed'), lm(3, 'wishlist', 0, 9)],
    shows: [ls(21, 'dropped'), ls(23, 'dropped'), ls(20, 'wishlist', 7)],
  }))
  ok(p.watchlist.same, 2, 'already wishlist here (movie 1, show 20)')
  ok(p.watchlist.skippedWatched, 1, 'on the watchlist but watched here: left alone')
  ok(p.watchlist.push.map(t => t.tmdbId), [3], 'wishlist here only → sent')
  ok(p.ratings.update.map(t => t.detail), ['6 → 8'], 'Trakt rating wins')
  ok(p.ratings.same, 1, 'same rating')
  ok(p.ratings.push.map(t => t.tmdbId), [3], 'rated here only → sent')
  ok(p.dropped.same, 1, 'dropped on both')
  ok(p.dropped.add.map(t => t.tmdbId), [22], 'dropped on Trakt only → marked dropped')
  ok(p.dropped.push.map(t => t.tmdbId), [23], 'dropped here only → sent')
}

// What the import really does: rating-only titles, half-watched titles, Dropped movies
{
  const pb = (item, progress = 40) => ({ item, season: item.type === 'show' ? 1 : null, episode: item.type === 'show' ? 2 : null, progress, pausedAt: null })
  const p = buildTraktPreview(snap({
    ratings: [{ item: movie(40), rating: 8, ratedAt: null }, { item: movie(41), rating: 6, ratedAt: null }, { item: show(42), rating: 7, ratedAt: null }],
    playback: [pb(movie(41)), pb(movie(43)), pb(movie(44)), pb(show(45)), pb(show(46)), pb(show(46))],
    watchedMovies: [{ item: movie(44), plays: 1, lastWatchedAt: null }, { item: movie(47), plays: 1, lastWatchedAt: null }],
    watchlist: [{ item: movie(43), rank: 1, listedAt: null }],
  }), lib({ shows: [ls(46)], movies: [lm(44), lm(47, 'dropped')] }))
  ok(p.ratings.skipped.map(t => t.tmdbId), [40, 42], 'a rating on a title that comes in no other way is not imported')
  ok(p.ratings.update.map(t => t.tmdbId), [41], 'a rating on a half-watched title comes with it')
  ok(p.playback.watching.map(t => t.tmdbId).sort((a, b) => a - b), [41, 43, 45], 'half-watched titles not in the library come in as Watching')
  ok(p.playback.live, 3, 'the rest (watched movie, show already here ×2) stays live in Continue watching')
  ok(p.watchlist.skippedWatched, 1, 'a half-watched watchlist title leaves the watchlist (watching beats wishlist)')
  ok(p.movies.update.some(u => u.tmdbId === 47), false, 'a Dropped movie with plays on Trakt stays Dropped (no change)')
  const r = previewReport(p, '03.10.2026 10:00')
  ok(r.includes('Rated on Trakt only, title not imported: 2'), true, 'report says which ratings are not imported')
  ok(r.includes('Half-watched, added as Watching: 3'), true, 'report says what Continue watching adds')
}

// Identity guards
{
  const noTmdb = { type: 'movie', ids: { trakt: 5, slug: null, tmdb: null, imdb: 'tt1', tvdb: null }, title: 'Odd', year: null }
  const p = buildTraktPreview(snap({
    watchedMovies: [{ item: noTmdb, plays: 1, lastWatchedAt: null }],
    watchlist: [{ item: noTmdb, rank: 1, listedAt: null }],
  }), lib({ movies: [lm(1), lm(1)] }))
  ok(p.unmatched.length, 1, 'no TMDB id → one unmatched entry, not a guessed row')
  ok(p.movies.add.length, 0, 'an unmatched item is never added')
  ok(p.duplicateLocal, 1, 'two local rows with one TMDB id are reported')
}

// Notes (traktNotes.ts): the import's own three-way plan
{
  const note = (tmdb, id, text, type = 'movie') => ({ type, tmdb, id, text, updatedAt: null })
  const ln = (tmdb, text, type = 'movie') => ({ type, tmdb, note: text, noteId: null, synced: null })
  const p = buildTraktPreview(snap({ notes: [note(1, 11, 'From Trakt'), note(2, 12, 'Same'), note(3, 13, 'Theirs'), note(99, 90, 'Not in library')] }),
    lib({ movies: [lm(1), lm(2), lm(3), lm(4)], notes: [ln(1, null), ln(2, 'Same'), ln(3, 'Mine'), ln(4, 'Only here')] }))
  ok(p.notes.fromTrakt.map(t => t.tmdbId), [1], 'a Trakt note on a library title is written here')
  ok(p.notes.push.map(t => t.tmdbId), [4], 'a note only here is sent to Trakt')
  ok(p.notes.differ.map(t => t.tmdbId), [3], 'a different note on each side is listed (Trakt\'s kept)')
  ok(p.notes.same, 1, 'the same note on both sides')
  ok(p.notes.notInLibrary, 1, 'a note on a title not in the library is left on Trakt')
  ok(p.notes.push[0].title, 'M4', 'rows carry the library title')
  ok(buildTraktPreview(snap(), lib()).notes, null, 'notes not read (older snapshot or a failed read): no notes section numbers')
  const r = previewReport(p, '07.10.2026 10:00')
  ok(r.includes('Here, not on Trakt (sent to Trakt): 1'), true, 'report carries the note counts')
}

{
  const p = buildTraktPreview(snap({ watchedMovies: [{ item: movie(9), plays: 2, lastWatchedAt: null }] }), lib())
  const r = previewReport(p, '30.09.2026 13:22')
  ok(r.includes('New from Trakt: 1'), true, 'report carries the counts')
  ok(r.includes('30.09.2026 13:22'), true, 'report carries the read time')
  ok(r.split('\n').some(l => l.startsWith('    - ')), true, 'report lists the titles behind a count')
}

console.log(`verify-trakt-preview: ${n} assertions passed`)
