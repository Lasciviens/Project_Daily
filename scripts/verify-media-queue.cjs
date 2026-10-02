#!/usr/bin/env node
/** verify-media-queue.cjs — the Queue's pure rules (src/features/media/queue/queueModel.ts). */
require('sucrase/register')
const Q = require('../src/features/media/queue/queueModel.ts')
let n = 0
const ok = (a, e, label) => { const x = JSON.stringify(a), y = JSON.stringify(e); if (x !== y) { console.error(`FAIL ${label}\n  expected ${y}\n  actual   ${x}`); process.exit(1) } n++ }

ok(Q.findQueueList([{ id: 3, name: 'Marvel' }, { id: 9, name: ' queue ' }, { id: 5, name: 'Queue' }])?.id, 5, 'the Queue is found by name, any case; the oldest wins')
ok(Q.findQueueList([{ id: 3, name: 'Marvel' }]), null, 'no Queue yet')
ok(Q.findQueueList(undefined), null, 'lists not loaded')
ok(Q.moveItem(['a', 'b', 'c', 'd'], 3, 0), ['d', 'a', 'b', 'c'], 'move to the top')
ok(Q.moveItem(['a', 'b', 'c'], 0, 1), ['b', 'a', 'c'], 'move down one')
ok(Q.moveItem(['a', 'b', 'c'], 1, 9), ['a', 'c', 'b'], 'a move past the end is clamped')
ok(Q.moveItem(['a', 'b'], 5, 0), ['a', 'b'], 'an unknown position changes nothing')
const items = [{ id: 'x', rank: 2, listedAt: '2026-01-02' }, { id: 'y', rank: null, listedAt: '2026-01-01' }, { id: 'z', rank: 1, listedAt: '2026-01-03' }]
ok(Q.sortQueue(items).map(i => i.id), ['z', 'x', 'y'], 'rank first, unranked last')
console.log(`verify-media-queue: ${n} assertions passed`)
