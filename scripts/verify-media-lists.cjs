#!/usr/bin/env node
/* Verification — listModel.ts (every list view's filter/sort/progress) and
 * discoverModel.ts (Discover's TMDB requests + client filters), via sucrase. */
require('sucrase/register')
const assert = require('node:assert/strict')
const L = require('../src/features/media/listModel')
const D = require('../src/features/media/discoverModel')

let n = 0
const ok = (a, e, m) => { assert.deepStrictEqual(a, e, m); n++ }
const TODAY = '2026-09-30'

// ── listModel ──
const t = (id, release, order, type = 'movie') => ({ type, tmdbId: id, title: `T${id}`, posterPath: null, release, year: release ? Number(release.slice(0, 4)) : null, order })
const titles = [t(1, '2012-05-04', 2), t(2, '2019-04-26', 1), t(3, '2027-05-01', 0), t(4, '2008-05-02', 3), t(5, null, 4)]
const index = new Map([
  ['movie:1', { tmdbId: 1, bucket: 'completed', rt: 91 }],
  ['movie:2', { tmdbId: 2, bucket: 'wishlist', rt: 94 }],
  ['movie:4', { tmdbId: 4, bucket: 'completed', rt: 94 }],
])
const rows = L.withLibrary(titles, index)
const ids = rs => rs.map(r => r.tmdbId)
ok(ids(L.filterList(rows, 'all', 'order', TODAY)), [3, 2, 1, 4, 5], 'list order')
ok(ids(L.filterList(rows, 'all', 'release', TODAY)), [4, 1, 2, 3, 5], 'release order, undated last')
ok(ids(L.filterList(rows, 'watched', 'release', TODAY)), [4, 1], 'watched = completed')
ok(ids(L.filterList(rows, 'unwatched', 'release', TODAY)), [2, 5], 'not watched leaves out unreleased titles')
ok(ids(L.filterList(rows, 'upcoming', 'release', TODAY)), [3], 'coming soon = release after today')
ok(ids(L.filterList(rows, 'library', 'order', TODAY)), [2, 1, 4], 'in my library')
ok(ids(L.filterList(rows, 'not_library', 'order', TODAY)), [3, 5], 'not in library')
ok(ids(L.filterList(rows, 'all', 'rt', TODAY)).slice(0, 3), [2, 4, 1], 'Rotten Tomatoes high first, ties by title')
ok(L.listCounts(rows, TODAY), { all: 5, watched: 2, watching: 0, unwatched: 2, library: 3, not_library: 2, upcoming: 1 }, 'counts match the filters')
const tvRows = L.withLibrary([t(7, '2020-01-01', 0, 'tv')], new Map([['tv:7', { tmdbId: 7, bucket: 'watching', rt: null }]]))
ok([L.filterList(tvRows, 'watching', 'order', TODAY).length, L.filterList(tvRows, 'unwatched', 'order', TODAY).length], [1, 0], 'a show midway through is In progress, not Not watched')
ok(L.watchedProgress(rows, TODAY), { watched: 2, released: 4 }, 'progress counts released titles only')
ok(L.withLibrary([t(1, null, 0, 'tv')], index)[0].item, null, 'a TV id never matches a movie with the same TMDB id')

// ── discoverModel ──
const F = D.NO_FILTERS
const req = (tab, type = 'movie', f = F, p = 1, prov) => D.discoverRequest(tab, type, f, TODAY, p, prov)
ok(req('today').path, '/trending/movie/day', 'trending today')
ok(req('week', 'tv').path, '/trending/tv/week', 'trending this week, TV')
const pop = req('popular')
ok([pop.path, pop.params.sort_by, pop.params['vote_count.gte'], pop.params['primary_release_date.gte'], pop.params['primary_release_date.lte']],
  ['/discover/movie', 'popularity.desc', '100', '2023-10-01', TODAY], 'Popular = recent films with a vote floor, not /movie/popular')
ok(req('top').params['vote_count.gte'], '1500', 'top rated needs many votes')
const cin = req('cinemas').params
ok([cin.region, cin.with_release_type, cin['release_date.gte'], cin['release_date.lte'], cin['vote_count.gte']], ['NO', '3', '2026-08-19', TODAY, undefined], 'in cinemas: theatrical releases in Norway, last six weeks')
const air = req('airing', 'tv').params
ok([air['air_date.gte'], air['air_date.lte']], [TODAY, '2026-10-07'], 'on the air: an episode in the next 7 days')
const up = req('upcoming').params
ok([up.with_release_type, up['release_date.gte'], up['release_date.lte'], up['vote_count.gte']], ['2|3', '2026-10-01', '2027-03-29', undefined], 'upcoming movies: cinema/limited releases from tomorrow to six months')
ok(req('upcoming', 'tv').params['first_air_date.gte'], '2026-10-01', 'TV upcoming uses first air date')
const upRated = req('upcoming', 'movie', { ...F, sort: 'rating', minRating: 8 }).params
ok([upRated.sort_by, upRated['vote_average.gte'], upRated['vote_count.gte']], ['popularity.desc', undefined, undefined], 'upcoming ignores score filters (nothing has a score yet)')
ok(req('upcoming', 'movie', { ...F, sort: 'newest' }).params.sort_by, 'release_date.asc', 'upcoming "newest" = soonest first')
ok(req('cinemas', 'movie', { ...F, sort: 'rating' }).params['vote_count.gte'], '20', 'a short window keeps a small floor under Best rated')
ok(req('popular', 'movie', { ...F, sort: 'rating' }).params['vote_count.gte'], '1500', 'Best rated on Popular uses Top rated\'s floor')
ok(req('norway').params.with_origin_country, 'NO', 'Norway')
const svc = req('services', 'movie', F, 1, [337, 8]).params
ok([svc.with_watch_providers, svc.with_watch_monetization_types], ['8|337', 'flatrate|free|ads'], 'my services: providers sorted and OR-joined, free and ad tiers included')
const filt = req('top', 'movie', { ...F, genre: 28, fromYear: 2010, minRating: 7 }).params
ok([filt.with_genres, filt['primary_release_date.gte'], filt['vote_average.gte'], filt.sort_by], ['28', '2010-01-01', '7', 'vote_average.desc'], 'filters: genre, year, score')
ok(req('popular', 'movie', { ...F, fromYear: 2010 }).params['primary_release_date.gte'], '2023-10-01', 'a year filter never widens Popular past its window')
ok(req('upcoming', 'movie', { ...F, fromYear: 2020 }).params['primary_release_date.gte'], undefined, 'a year filter never widens upcoming into the past')
const newest = req('popular', 'movie', { ...F, sort: 'newest' }).params
ok([newest.sort_by, newest['primary_release_date.lte']], ['primary_release_date.desc', TODAY], 'newest stops at today')
ok(req('popular', 'movie', F, 3).params.page, '3', 'page number')

const items = [
  { id: 1, genre_ids: [28], vote_average: 7.5, release_date: '2021-01-01' },
  { id: 2, genre_ids: [18], vote_average: 8.1, release_date: '2015-01-01' },
  { id: 1, genre_ids: [28], vote_average: 7.5, release_date: '2021-01-01' },
  { id: 3, genre_ids: [28], vote_average: 5.0, release_date: '2023-01-01' },
]
const c = (tab, f, lib = () => false) => D.applyClientFilters(tab, items, f, lib).map(i => i.id)
ok(c('today', F), [1, 2, 3], 'duplicates across pages are dropped')
ok(c('today', { ...F, genre: 28, minRating: 6 }), [1], 'trending: genre and score applied on the client')
ok(c('today', { ...F, fromYear: 2020 }), [1, 3], 'trending: year applied on the client')
ok(c('popular', { ...F, genre: 18 }), [1, 2, 3], 'server lists are not filtered twice')
ok(c('popular', { ...F, hideLibrary: true }, id => id === 2), [1, 3], 'hide titles in my library')
ok(D.activeFilterCount({ ...F, genre: 1, hideLibrary: true }), 2, 'active filter count')
ok(D.activeFilterCount({ ...F, sort: 'rating' }, 'today'), 0, 'a sort does not count on trending (it does nothing there)')

console.log(`verify-media-lists: ${n} assertions passed`)
