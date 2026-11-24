#!/usr/bin/env node
/** verify-media-queue.cjs — the Queue's pure rules (src/features/media/queue/queueModel.ts). */
require('sucrase/register')
const Q = require('../src/features/media/queue/queueModel.ts')
const T = require('../src/features/media/trakt/traktQueue.ts')
let n = 0
const ok = (a, e, label) => { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) { console.error(`FAIL ${label}\n  expected ${y}\n  actual   ${x}`); process.exit(1) } n++ }

ok(Q.findQueueList([{ id: 3, name: 'Marvel' }, { id: 9, name: ' queue ' }, { id: 5, name: 'Queue' }])?.id, 5, 'the Queue is found by name, any case; the oldest wins')
ok(Q.findQueueList([{ id: 3, name: 'Marvel' }]), null, 'no Queue yet')
ok(Q.findQueueList(undefined), null, 'lists not loaded')
ok(Q.findQueueList([{ id: 3, name: 'Watch next', queue: true }, { id: 2, name: 'Queue', queue: false }])?.id, 3, 'trakt-api\'s flag wins over the name (a renamed Queue stays the Queue)')
ok(Q.findQueueList([{ id: 3, name: 'Marvel', queue: false }, { id: 5, name: 'Queue', queue: false }]), null, 'flags and none set: no Queue, whatever the names')

// 207: which list is the Queue — by its marked id, never by name alone
ok(T.queueListOf([{ id: 9, name: 'Queue' }, { id: 12, name: 'Renamed' }], new Set([12])), { id: 12, adopt: false }, 'a marked list is the Queue, renamed or not')
ok(T.queueListOf([{ id: 20, name: 'B' }, { id: 12, name: 'A' }], new Set([20, 12])), { id: 12, adopt: false }, 'several marks: the oldest list there is')
ok(T.queueListOf([{ id: 9, name: ' queue ' }, { id: 4, name: 'Queue' }], new Set([77])), { id: 4, adopt: true }, 'no marked list on Trakt: the oldest "Queue" is adopted (marked)')
ok(T.queueListOf([{ id: 9, name: 'Marvel' }], new Set()), null, 'no Queue at all')
ok(T.queueListOf([{ id: null, name: 'Queue' }], new Set()), null, 'a list without an id is never the Queue')
ok(T.isQueueName(' QUEUE '), true, 'the name in any case and spacing')
ok(T.isQueueName('Queue 2'), false, 'another name')

// 207: films that leave the Queue — Completed, with a watch recorded since they were queued
const lib = new Map([
  [1, { status: 'completed', recordedAt: ['2026-11-20T10:00:00+00:00'] }],
  [2, { status: 'completed', recordedAt: ['2026-01-01T10:00:00+00:00'] }],
  [3, { status: 'watching', recordedAt: ['2026-11-21T10:00:00+00:00'] }],
  [4, { status: 'completed', recordedAt: ['2026-01-01T10:00:00+00:00', '2026-11-22T08:00:00.123+00:00'] }],
  [5, { status: 'completed', recordedAt: [] }],
])
const at = '2026-11-19T12:00:00.000Z'
ok(T.queueMoviesWatched([{ tmdb: 1, listedAt: at }], lib), [1], 'watched after it was queued: leaves')
ok(T.queueMoviesWatched([{ tmdb: 2, listedAt: at }], lib), [], 'watched only before it was queued (a rewatch): stays')
ok(T.queueMoviesWatched([{ tmdb: 3, listedAt: at }], lib), [], 'a rewatch still running (Watching): stays')
ok(T.queueMoviesWatched([{ tmdb: 4, listedAt: at }], lib), [4], 'the rewatch is recorded: leaves')
ok(T.queueMoviesWatched([{ tmdb: 5, listedAt: at }], lib), [], 'Completed without a watch row: stays (nothing says when)')
ok(T.queueMoviesWatched([{ tmdb: 1, listedAt: null }, { tmdb: null, listedAt: at }, { tmdb: 1, listedAt: 'soon' }], lib), [], 'an unknown date or title keeps the film')
ok(T.queueMoviesWatched([{ tmdb: 9, listedAt: at }], lib), [], 'not in the library: stays')
ok(T.queueMoviesWatched([{ tmdb: 1, listedAt: '2026-11-20T10:00:00.000Z' }, { tmdb: 1, listedAt: at }], lib), [1], 'the same second counts; one id once')
ok(Q.moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'], 'move to the top')
ok(Q.moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'], 'move down one')
ok(Q.moveItem(['a', 'b', 'c'], 1, 9), ['a', 'c', 'b'], 'a move past the end is clamped')
ok(Q.moveItem(['a', 'b'], 5, 0), ['a', 'b'], 'an unknown position changes nothing')
const items = [{ id: 'x', rank: 2, listedAt: '2026-01-02' }, { id: 'y', rank: null, listedAt: '2026-01-01' }, { id: 'z', rank: 1, listedAt: '2026-01-03' }]
ok(Q.sortQueue(items).map(i => i.id), ['z', 'x', 'y'], 'rank first, unranked last')
console.log(`verify-media-queue: ${n} assertions passed`)
