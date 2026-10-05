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
eq(s.bookPatch({ ...base, on_device: false }, { md5, on_device: true }).on_device, true, 'listed by the device again → on device')
eq(s.bookPatch({ ...base, on_device: false }, { md5 }).on_device, undefined, 'a stats-only row does not say the book is on the device')
eq(s.newBookRow({ md5 }).on_device, false, 'new from stats only → not on device')
eq(s.newBookRow({ md5, on_device: true }).on_device, true, 'new from the library → on device')
eq(s.bookPatch({ ...base, last_read_at: '2026-10-05T00:00:00.000Z' }, { md5, last_open: now - 86400 * 30 }).last_read_at, undefined, 'older last open ignored')

ok(s.validateSync({ device_id: 'k', device_time: now, inventory_md5s: ['x'] }, now), 'bad inventory md5 refused')
eq(s.validateSync({ device_id: 'k', device_time: now, inventory_md5s: [md5] }, now), null, 'inventory list ok')
const pg = { ...base, last_read_at: '2026-10-04T10:00:00+00:00', progress_pct: '42.50', read_seconds: 600 }
eq(s.bookPatch(pg, { md5, last_open: Date.parse('2026-10-04T10:00:00Z') / 1000, percent: 0.425, read_time: 600 }), {}, 'PostgREST text forms compare as values: no rewrite')
eq(s.lastSeenIso(now - 60, now), new Date((now - 60) * 1000).toISOString(), 'device clock used when close')
eq(s.lastSeenIso(now - 3 * 86400, now), new Date(now * 1000).toISOString(), 'skewed clock → server time')

// News Downloader issues are news, not books
eq(s.isNewsPath('/mnt/onboard/.adds/koreader/news/Feed - 2026-10-05.epub'), true, 'news folder')
eq(s.isNewsPath('/mnt/onboard/Books/News of the World.epub'), false, 'a book called news')
eq(s.newBookRow({ md5, path: '/mnt/onboard/.adds/koreader/news/x.epub' }).kind, 'news', 'new row from the news folder → news')
eq(s.newBookRow({ md5, kind: 'news' }).kind, 'news', 'plugin flag → news')
eq(s.newBookRow({ md5 }).kind, 'book', 'default kind book')
eq(s.bookPatch({ ...base, kind: 'book' }, { md5, kind: 'news', path: '/mnt/onboard/.adds/koreader/news/x.epub' }).kind, undefined, 'an existing row keeps its kind (the owner may have moved it out of News)')
eq(s.bookPatch({ ...base, read_status: 'paused', device_status: 'reading' }, { md5, status: 'abandoned' }).read_status, undefined, 'on hold on the Kobo keeps Paused')
eq(s.bookPatch({ ...base, read_status: 'reading', device_status: 'reading' }, { md5, status: 'abandoned' }).read_status, 'dropped', 'on hold on the Kobo drops a Reading book')

// App → Kobo pushes
const row = { koreader_md5: md5, file_path: '/mnt/onboard/a.epub', on_device: true, kind: 'book', read_status: 'finished', rating: 8, device_status: 'reading', device_rating: 4 }
eq(s.pushFor(row), { md5, path: '/mnt/onboard/a.epub', status: 'complete' }, 'finished in the app → complete on the Kobo')
eq(s.pushFor({ ...row, device_status: 'complete' }), null, 'already in step')
eq(s.pushFor({ ...row, read_status: 'paused', device_status: 'abandoned' }), null, 'paused ≈ on hold')
eq(s.pushFor({ ...row, read_status: 'dropped', device_status: 'abandoned' }), null, 'dropped ≈ on hold')
eq(s.pushFor({ ...row, read_status: 'want', device_status: null }), null, 'want ≈ no status')
eq(s.pushFor({ ...row, read_status: 'want', device_status: 'reading', rating: null }), null, 'want is never pushed')
eq(s.pushFor({ ...row, device_status: 'complete', rating: 10 }), { md5, path: '/mnt/onboard/a.epub', rating: 5 }, 'rating 10 → 5 stars')
eq(s.pushFor({ ...row, device_status: 'complete', rating: null }), null, 'no rating in the app → leave the device rating')
eq(s.pushFor({ ...row, on_device: false }), null, 'not on the Kobo')
eq(s.pushFor({ ...row, kind: 'news' }), null, 'news never pushed')
eq(s.pushFor({ ...row, file_path: null }), null, 'no path')
eq(s.starsFor(1), 1, '1/10 → 1 star (never 0)'); eq(s.starsFor(5), 3, '5/10 → 3 stars (half up)'); eq(s.starsFor(7), 4, '7/10 → 4')
eq(s.appliedPatch({ status: 'complete', rating: 5 }), { device_status: 'complete', device_rating: 5 }, 'applied → device values')
eq(s.appliedPatch({ status: 'bogus', rating: 9 }), {}, 'junk ignored')
// After the device confirms, the next sync reads the same values back: no flip.
const synced = { ...base, read_status: 'paused', device_status: 'abandoned', device_rating: 3 }
eq(s.bookPatch(synced, { md5, status: 'abandoned', rating: 3 }), {}, 'paused stays paused after the push round trip')
console.log(`verify-reading-sync: ${n} assertions passed`)
