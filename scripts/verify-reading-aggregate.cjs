// Verifies src/features/books/readingAggregate.ts (sucrase, no test framework).
require('sucrase/register')
process.env.TZ = 'Europe/Oslo'
const a = require('../src/features/books/readingAggregate.ts')
let n = 0
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } n++ }
const eq = (x, y, m) => ok(JSON.stringify(x) === JSON.stringify(y), `${m}: ${JSON.stringify(x)} !== ${JSON.stringify(y)}`)
const ev = (book, iso, dur, page = 1) => ({ book_id: book, page, started_at: new Date(iso).toISOString(), duration_seconds: dur })

eq(a.addDays('2026-10-31', 1), '2026-11-01', 'month boundary')
eq(a.addDays('2026-03-29', -1), '2026-03-28', 'DST day back')
eq(a.dayRange('2026-10-01', '2026-10-03'), ['2026-10-01', '2026-10-02', '2026-10-03'], 'range inclusive')
const by = a.secondsByDay([ev('b', '2026-10-04T23:30:00+02:00', 600), ev('b', '2026-10-05T00:10:00+02:00', 300)])
eq([...by.entries()], [['2026-10-04', 600], ['2026-10-05', 300]], 'local midnight splits days')

// Day states: unknown after last sync, zero before it; today never zero.
eq(a.dayState('2026-10-03', 0, '2026-10-05', '2026-10-04', 1), 'zero', 'synced day with nothing is zero')
eq(a.dayState('2026-10-04', 0, '2026-10-05', '2026-10-04', 1), 'unknown', 'the last-sync day itself is not yet complete')
eq(a.dayState('2026-10-04', 0, '2026-10-05', null, 1), 'unknown', 'never synced → unknown')
eq(a.dayState('2026-10-05', 0, '2026-10-05', '2026-10-05', 1), 'today', 'today is never zero')
eq(a.dayState('2026-10-03', 30, '2026-10-05', '2026-10-04', 1), 'short', 'under the threshold')
eq(a.dayState('2026-10-03', 600, '2026-10-05', '2026-10-04', 5), 'read', 'read day')

const days = new Map([['2026-10-01', 900], ['2026-10-02', 900], ['2026-10-03', 900]])
eq(a.computeStreak(days, '2026-10-05', '2026-10-03', 1, '2026-10-01'), { current: 3, longest: 3, atRisk: true }, 'unsynced yesterday does not break the streak')
eq(a.computeStreak(days, '2026-10-05', '2026-10-05', 1, '2026-10-01').current, 0, 'a synced empty yesterday breaks it')
const withToday = new Map([...days, ['2026-10-04', 900], ['2026-10-05', 900]])
eq(a.computeStreak(withToday, '2026-10-05', '2026-10-05', 1, '2026-10-01'), { current: 5, longest: 5, atRisk: false }, 'today read counts')
eq(a.computeStreak(new Map([['2026-09-28', 900], ['2026-10-01', 900]]), '2026-10-01', '2026-10-01', 1, '2026-09-28'), { current: 1, longest: 1, atRisk: false }, 'gap resets longest')
eq(a.computeStreak(new Map(), '2026-10-05', null, 1, null), { current: 0, longest: 0, atRisk: false }, 'nothing at all')

const s = a.sessions([
  ev('b', '2026-10-04T20:00:00Z', 60, 1), ev('b', '2026-10-04T20:01:00Z', 60, 2), ev('b', '2026-10-04T20:02:00Z', 60, 3),
  ev('b', '2026-10-04T21:00:00Z', 60, 4), // 57 min gap → new session
  ev('c', '2026-10-04T21:01:05Z', 5, 1), // other book, under 10 s → dropped
])
eq(s.map(x => [x.bookId, x.seconds, x.pages]), [['b', 180, 3], ['b', 60, 1]], 'sessions split on gap and book, tiny dropped')
const idle = a.sessions([ev('b', '2026-10-04T20:00:00Z', 30), ev('b', '2026-10-04T20:20:00Z', 30)])
eq(idle[0].seconds, 60, 'idle gap inside a session is not counted')

const bb = a.byBook([ev('b', '2026-10-04T20:00:00Z', 400, 1), ev('b', '2026-10-04T20:07:00Z', 400, 2), ev('c', '2026-10-04T10:00:00Z', 100, 9)])
eq(bb.map(x => [x.bookId, x.seconds, x.pages, x.sessions, x.pagesPerHour]), [['b', 800, 2, 1, 9], ['c', 100, 1, 1, null]], 'per book with speed only past 10 min')
const g = a.hourGrid([ev('b', '2026-10-05T07:30:00+02:00', 120)]) // Monday 07:30 Oslo
eq(g[0][7], 120, 'weekday × hour grid, Monday first')

eq(a.formatDuration(40), '40 s', 'seconds'); eq(a.formatDuration(720), '12 min', 'minutes'); eq(a.formatDuration(3900), '1 h 5 min', 'hours'); eq(a.formatDuration(7200), '2 h', 'whole hours')

const B = (o) => ({ id: o.id, title: o.title ?? o.id, author: o.author ?? null, series: null, read_status: o.st ?? 'want', queue_order: o.q ?? null, created_at: o.c ?? '2026-01-01', last_read_at: o.lr ?? null, progress_pct: o.p ?? null, koreader_md5: null, read_seconds: null })
eq(a.upNext([B({ id: 'x', q: 2 }), B({ id: 'y', q: 1 }), B({ id: 'z' }), B({ id: 'r', st: 'reading' })]).map(b => b.id), ['y', 'x', 'z'], 'queue: ordered first, then by added')
const q = a.upNext([B({ id: 'a', q: 1 }), B({ id: 'b', q: 2 }), B({ id: 'c' })])
eq(a.moveInQueue(q, 'c', -1), [{ id: 'c', queue_order: 2 }, { id: 'b', queue_order: 3 }], 'move up renumbers only what changed')
eq(a.moveInQueue(q, 'a', -1), [], 'cannot move the first up')
ok(a.matchesSearch(B({ id: '1', title: 'Snømannen', author: 'Jo Nesbø' }), 'nesbo'), 'accent-folded search')
ok(!a.matchesSearch(B({ id: '1', title: 'Sult' }), 'hunger'), 'search misses')
eq(a.sortForLibrary([B({ id: 'a', lr: '2026-10-01' }), B({ id: 'b', lr: '2026-10-03' })], 'recent').map(b => b.id), ['b', 'a'], 'recent first')
eq(a.duplicatePairs([B({ id: '1', title: 'Vegetarian, The', author: 'Han Kang' }), B({ id: '2', title: 'The Vegetarian', author: 'Han  Kang' }), B({ id: '3', title: 'Other' })]).map(p => p.map(b => b.id)), [['1', '2']], 'sort-form title duplicates')
eq(a.duplicatePairs([{ ...B({ id: '1', title: 'Sult', author: 'Hamsun' }), koreader_md5: 'a'.repeat(32) }, { ...B({ id: '2', title: 'Sult', author: 'Hamsun' }), koreader_md5: 'b'.repeat(32) }]).length, 0, 'two real files (epub + kepub) are not offered for merge')
console.log(`verify-reading-aggregate: ${n} assertions passed`)
