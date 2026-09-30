require('sucrase/register')
const assert = require('assert')
const { resolveWatchedAt, middayIso, watchedWhenLabel, UNKNOWN_EPISODE_WATCHED_AT } = require('../src/features/media/watchedWhen.ts')
process.env.TZ = 'Europe/Oslo'
const now = '2026-09-30T10:00:00.000Z'
let n = 0
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++ }
eq(resolveWatchedAt({ kind: 'now' }, '2020-01-01', 'episode', now), now, 'now')
eq(resolveWatchedAt({ kind: 'other', iso: '2025-05-05T20:00:00.000Z' }, null, 'movie', now), '2025-05-05T20:00:00.000Z', 'other')
eq(resolveWatchedAt({ kind: 'unknown' }, null, 'movie', now), null, 'movie unknown = null')
eq(resolveWatchedAt({ kind: 'unknown' }, null, 'episode', now), UNKNOWN_EPISODE_WATCHED_AT, 'episode unknown = epoch')
eq(resolveWatchedAt({ kind: 'release' }, '2024-03-01', 'movie', now), middayIso('2024-03-01'), 'release date')
eq(resolveWatchedAt({ kind: 'release' }, null, 'episode', now), now, 'release unknown -> now')
eq(resolveWatchedAt({ kind: 'release' }, '2027-01-01', 'episode', now), now, 'future release -> now')
eq(middayIso('2024-03-01').slice(0, 10), '2024-03-01', 'midday keeps the day')
eq(watchedWhenLabel({ kind: 'other', iso: '2025-05-05T20:00:00.000Z' }), 'on 05.05.2025', 'label DD.MM.YYYY')
console.log(`verify-watched-when: ${n} assertions passed`)
