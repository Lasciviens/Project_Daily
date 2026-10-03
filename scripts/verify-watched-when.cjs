require('sucrase/register')
const assert = require('assert')
const { resolveWatchedAt, seriesWatchedDates, middayIso, watchedWhenLabel, UNKNOWN_EPISODE_WATCHED_AT } = require('../src/features/media/watchedWhen.ts')
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
{
  const r = seriesWatchedDates({ kind: 'release' }, '2010-04-01', '2015-06-20', now)
  eq(r.started_at.slice(0, 10), '2010-04-01', 'series release: start = first air day')
  eq(r.finished_at.slice(0, 10), '2015-06-20', 'series release: finish = last air day, not today')
  eq(seriesWatchedDates({ kind: 'unknown' }, '2010-04-01', '2015-06-20', now).finished_at, null, 'series unknown -> no dates')
  eq(seriesWatchedDates({ kind: 'now' }, '2010-04-01', '2015-06-20', now).finished_at, now, 'series now -> now')
  eq(seriesWatchedDates({ kind: 'other', iso: '2025-05-05T12:00:00.000Z' }, null, null, now).finished_at, '2025-05-05T12:00:00.000Z', 'series other')
}
console.log(`verify-watched-when: ${n} assertions passed`)
