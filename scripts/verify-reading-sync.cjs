// Verifies src/features/books/readingSync.ts — the Kobo plugin's sync contract (sucrase, no test framework).
require('sucrase/register')
const s = require('../src/features/books/readingSync.ts')
let n = 0
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } n++ }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)
const now = 1791100000 // 2026-10-04
const md5 = 'a'.repeat(32)

eq(s.validateSync({ device_id: 'k', device_time: now }, now), null, 'minimal body ok')
ok(s.validateSync(null, now), 'null body refused')
ok(s.validateSync({ device_time: now }, now), 'device_id required')
ok(s.validateSync({ device_id: 'k', device_time: now + 8 * 86400 }, now), 'future device clock refused')
ok(s.validateSync({ device_id: 'k', device_time: now, books: [{ md5: 'XYZ' }] }, now), 'bad md5 refused')
ok(s.validateSync({ device_id: 'k', device_time: now, stats: { nope: [] } }, now), 'bad stats key refused')
ok(s.validateSync({ device_id: 'k', device_time: now, stats: { [md5]: Array(5001).fill([1, now, 1, 1]) } }, now), 'too many events refused')

eq(s.parseEvent([3, now - 100, 42, 300], now), { page: 3, start: now - 100, duration: 42, total: 300 }, 'event parsed')
eq(s.parseEvent([3, now - 100, 42], now), { page: 3, start: now - 100, duration: 42, total: null }, 'total optional')
eq(s.parseEvent([3, 0, 42, 300], now), null, 'epoch zero refused')
eq(s.parseEvent([3, now + 2 * 86400, 42, 300], now), null, 'far future refused')
eq(s.parseEvent([3, now - 100, 90000, 300], now), null, 'duration over a day refused')
eq(s.parseEvent([-1, now, 4, 1], now), null, 'negative page refused')
eq(s.parseEvent('x', now), null, 'not an array')

eq(s.mapDeviceStatus('complete'), 'finished', 'complete → finished')
eq(s.mapDeviceStatus('abandoned'), 'dropped', 'abandoned → dropped')
eq(s.mapDeviceStatus('reading'), 'reading', 'reading')
eq(s.mapDeviceStatus('new'), null, 'new → nothing')
eq(s.toPercent(0.5), 50, 'fraction → percent')
eq(s.toPercent(0.01), 1, 'Nickel 1 % arrives as 0.01, not 100 %')
eq(s.toPercent(1), 100, 'one is finished')
eq(s.toPercent(37), null, 'a raw 0–100 value is refused, never misread')
eq(s.titleFromPath('file:///mnt/onboard/Books/Sult_Knut%20Hamsun.kepub.epub'), 'Sult Knut Hamsun', 'title from path')

const fresh = s.newBookRow({ md5, title: 'Sult', authors: 'Knut Hamsun', percent: 0.25, last_open: now - 3600, rating: 4, status: 'reading' })
eq(fresh.read_status, 'reading', 'new: sidecar status')
eq(fresh.rating, 8, 'new: 4 stars → 8/10')
eq(fresh.progress_pct, 25, 'new: progress')
ok(fresh.started_at, 'new: started_at stamped')
eq(s.newBookRow({ md5 }).read_status, 'want', 'new unopened → want')
eq(s.newBookRow({ md5 }).title, 'Untitled', 'no title anywhere')
eq(s.newBookRow({ md5, percent: 0.1 }).read_status, 'reading', 'progress → reading')

const base = { ...s.newBookRow({ md5, title: 'Sult' }), title: 'Hunger (my title)', read_status: 'paused', device_status: 'reading', device_rating: 3 }
eq(s.bookPatch(base, { md5, title: 'Sult', status: 'reading', rating: 3 }), {}, 'nothing changed → empty patch (app edits kept)')
eq(s.bookPatch(base, { md5, status: 'complete' }).read_status, 'finished', 'device status change applied')
ok(s.bookPatch(base, { md5, status: 'complete', last_open: now }).finished_at, 'finish stamps finished_at')
eq(s.bookPatch(base, { md5, title: 'Other' }).title, undefined, 'owner title kept')
eq(s.bookPatch({ ...base, author: null }, { md5, authors: 'Hamsun' }).author, 'Hamsun', 'empty author filled')
eq(s.bookPatch(base, { md5, rating: 5 }).rating, 10, 'rating change applied')
eq(s.bookPatch({ ...base, read_status: 'want', device_status: null }, { md5, percent: 0.3 }).read_status, 'reading', 'want with progress → reading')
eq(s.bookPatch({ ...base, on_device: false }, { md5 }).on_device, true, 'seen again → on device')
eq(s.bookPatch({ ...base, last_read_at: '2026-10-05T00:00:00.000Z' }, { md5, last_open: now - 86400 * 30 }).last_read_at, undefined, 'older last open ignored')

ok(s.validateSync({ device_id: 'k', device_time: now, inventory_md5s: ['x'] }, now), 'bad inventory md5 refused')
eq(s.validateSync({ device_id: 'k', device_time: now, inventory_md5s: [md5] }, now), null, 'inventory list ok')
const pg = { ...base, last_read_at: '2026-10-04T10:00:00+00:00', progress_pct: '42.50', read_seconds: 600 }
eq(s.bookPatch(pg, { md5, last_open: Date.parse('2026-10-04T10:00:00Z') / 1000, percent: 0.425, read_time: 600 }), {}, 'PostgREST text forms compare as values: no rewrite')
eq(s.lastSeenIso(now - 60, now), new Date((now - 60) * 1000).toISOString(), 'device clock used when close')
eq(s.lastSeenIso(now - 3 * 86400, now), new Date(now * 1000).toISOString(), 'skewed clock → server time')
console.log(`verify-reading-sync: ${n} assertions passed`)
