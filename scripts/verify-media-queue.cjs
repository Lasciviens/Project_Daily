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

// 207: films that leave the Queue — every film the library has as Completed (owner: "Completed movie should get out of the queue")
const status = new Map([[1, 'completed'], [3, 'watching'], [4, 'wishlist'], [5, 'dropped'], [6, 'paused']])
ok(T.queueMoviesCompleted([{ tmdb: 1 }], status), [1], 'a Completed film leaves, whenever it was watched')
ok(T.queueMoviesCompleted([{ tmdb: 3 }], status), [], 'a film being rewatched (Watching) stays')
ok(T.queueMoviesCompleted([{ tmdb: 4 }, { tmdb: 5 }, { tmdb: 6 }], status), [], 'Wishlist, Dropped and Paused stay')
ok(T.queueMoviesCompleted([{ tmdb: 9 }, { tmdb: null }], status), [], 'not in the library, or no TMDB id: stays')
ok(T.queueMoviesCompleted([{ tmdb: 1 }, { tmdb: 1 }, { tmdb: 3 }], status), [1], 'one id once')
ok(T.queueAddNeedsRewatch('movie', 'completed'), true, 'adding a Completed film asks to start a rewatch first')
ok(T.queueAddNeedsRewatch('movie', 'watching'), false, 'a film being watched (or rewatched) is added as it is')
ok(T.queueAddNeedsRewatch('movie', undefined), false, 'a film not in the library is added as it is')
ok(T.queueAddNeedsRewatch('show', 'completed'), false, 'a series is added as it is (only films leave)')
console.log(`verify-media-queue: ${n} assertions passed`)
