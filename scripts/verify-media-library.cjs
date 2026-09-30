#!/usr/bin/env node
/*
 * Verification — the Media library model (libraryModel.ts) via sucrase:
 * Coming soon vs Wishlist by date, bucket counts, filter/search/sort, and the
 * overview's poster row.
 */
require('sucrase/register')
const assert = require('node:assert/strict')
const { libraryItems, bucketCounts, filterLibrary, summaryPosters } = require('../src/features/media/libraryModel')

let n = 0
const ok = (a, e, m) => { assert.deepStrictEqual(a, e, m); n++ }
const TODAY = '2026-09-30'
const mv = (id, status, date, extra = {}) => ({
  status, rating: null, created_at: `2026-01-${String(id).padStart(2, '0')}T00:00:00Z`, repeat_count: 0,
  movie: { tmdb_id: id, title: `Movie ${id}`, release_date: date, poster_path: null }, ...extra,
})
const movies = [
  mv(1, 'wishlist', '2026-12-15'),
  mv(2, 'wishlist', '2020-01-01'),
  mv(3, 'upcoming', '2019-05-05'),
  mv(4, 'completed', '2015-01-01', { rating: 9 }),
  mv(5, 'completed', null, { rating: 6, movie: { tmdb_id: 5, title: 'Ångström', release_date: null, poster_path: null } }),
  mv(6, 'watching', '2024-01-01'),
]
const items = libraryItems('movies', movies, [], TODAY)
const byId = id => items.find(i => i.tmdbId === id).bucket

ok(byId(1), 'coming', 'a future release on the wishlist is Coming soon')
ok(byId(2), 'wishlist', 'a released wishlist film stays Wishlist')
ok(byId(3), 'wishlist', 'a legacy upcoming status that has released falls into Wishlist')
ok(bucketCounts(items), { coming: 1, wishlist: 2, watching: 1, paused: 0, completed: 2, dropped: 0 }, 'counts per bucket')
ok(filterLibrary(items, 'completed', '', 'rating').map(i => i.tmdbId), [4, 5], 'rating sort, highest first')
ok(filterLibrary(items, 'all', 'angstrom', 'title').map(i => i.tmdbId), [5], 'search folds accents')
ok(filterLibrary(items, 'all', '', 'year').at(-1).tmdbId, 5, 'no release year sorts last')
ok(filterLibrary(items, 'all', '', 'added')[0].tmdbId, 6, 'recently added first')
ok(summaryPosters(items).map(i => i.tmdbId), [6, 1, 3, 2], 'poster row: watching, then coming soon, then wishlist (newest first)')
ok(libraryItems('tv', [], [{ status: 'paused', rating: null, created_at: 'x', tv_series: { tmdb_id: 9, title: 'S', first_air_date: '2010-01-01', poster_path: null } }], TODAY)[0].bucket, 'paused', 'a paused show keeps its own bucket')

console.log(`verify-media-library: ${n} assertions passed`)
