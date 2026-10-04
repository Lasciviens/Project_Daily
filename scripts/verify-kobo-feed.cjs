// Verifies src/features/books/opdsFeed.ts (sucrase, no test framework).
require('sucrase/register')
const f = require('../src/features/books/opdsFeed.ts')
let n = 0
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1) } n++ }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`)
const now = Date.parse('2026-10-04T12:00:00Z')
const row = (o) => ({ id: 'a', filename: 'Book.epub', mime: 'application/epub+zip', size_bytes: 1048576, title: null, author: null, status: 'queued', created_at: '2026-10-04T10:00:00.000Z', downloaded_at: null, ...o })

eq(f.xmlEscape(`a&b<c>"d"'e'`), 'a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;', 'five entities')
eq(f.displayTitle(row({ filename: 'Sult_Knut-Hamsun.kepub.epub' })), 'Sult Knut-Hamsun', 'title from file name')
eq(f.displayTitle(row({ title: ' Sult ' })), 'Sult', 'own title wins')
eq(f.safeFileName('a/b:c?.epub'), 'a_b_c_.epub', 'unsafe characters')
eq(f.acquisitionType(row({ filename: 'x.pdf' })), 'application/pdf', 'pdf type')
eq(f.acquisitionType(row({ filename: 'x.kepub.epub' })), 'application/epub+zip', 'kepub is epub')

const rows = [
  row({ id: 'q-new', created_at: '2026-10-04T11:00:00.000Z' }),
  row({ id: 'q-old', created_at: '2026-09-26T11:00:00.000Z' }),
  row({ id: 'd-recent', status: 'downloaded', downloaded_at: '2026-10-04T06:00:00.000Z' }),
  row({ id: 'd-stale', status: 'downloaded', downloaded_at: '2026-10-03T11:00:00.000Z' }),
  row({ id: 'c', status: 'cancelled' }),
]
eq(f.feedEntries(rows, now).map(r => r.id), ['q-new', 'd-recent', 'q-old'], 'feed: queued + recent downloads, newest first')
eq(f.sweepTargets(rows, now).map(r => r.id).sort(), ['d-stale', 'q-old'], 'sweep: 24 h after download, 7 days undelivered')
ok(f.feedEtag(rows) !== f.feedEtag(rows.slice(1)), 'etag changes with entries')
eq(f.feedEtag(rows), f.feedEtag(rows), 'etag is stable')

const base = 'https://x.supabase.co/functions/v1/kobo-sync'
const xml = f.buildFeed(base, 'tok', f.feedEntries(rows, now), '2026-10-04T11:00:00.000Z')
ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'xml declaration')
ok(xml.includes('href="https://x.supabase.co/functions/v1/kobo-sync/opds/tok/books/q-new/Book.epub" type="application/epub+zip"'), 'absolute stable acquisition link')
ok(!/href="[^h]/.test(xml), 'no relative links')
ok(!xml.includes("href='"), 'double-quoted attributes')
ok(xml.includes('· sent 04.10.2026'), 'DD.MM.YYYY date')
ok(f.buildFeed(base, 'tok', [row({ author: 'Hamsun & Co' })], 'x').includes('<author><name>Hamsun &amp; Co</name></author>'), 'escaped single author')

eq(f.parseRoute('/kobo-sync/opds/tok/'), { kind: 'feed', token: 'tok' }, 'feed route')
eq(f.parseRoute('/functions/v1/kobo-sync/opds/tok/books/id1/Book.epub'), { kind: 'book', token: 'tok', id: 'id1' }, 'book route')
eq(f.parseRoute('/kobo-sync/sweep'), { kind: 'sweep' }, 'sweep route')
eq(f.parseRoute('/kobo-sync/'), null, 'unknown route')
eq(f.parseRoute('/functions/v1/kobo-sync/sync'), { kind: 'sync' }, 'sync route')
eq(f.parseRoute('/kobo-sync/inbox'), { kind: 'inbox' }, 'inbox route')
eq(f.parseRoute('/kobo-sync/deliveries/abc/ack'), { kind: 'ack', id: 'abc' }, 'ack route')
eq(f.parseRoute('/kobo-sync/opds/tok/sync'), null, 'sync under opds is not the plugin route')
const tr = '[Harry Potter _3] Rowling, J. K. - Harry Potter ve Azkaban Tutsağı 3.epub'
eq(f.storageFileName(tr), 'book.epub', 'storage key is plain ASCII')
eq(f.storageFileName('A.kepub.epub'), 'book.kepub.epub', 'storage key keeps kepub')
eq(f.storageFileName('A.PDF'), 'book.pdf', 'storage key keeps pdf')
const cd = f.contentDisposition('Tutsağı "ı".epub')
ok([...cd].every(ch => ch.charCodeAt(0) < 256), 'content-disposition is Latin-1 only')
ok(cd.includes('filename="Tutsag_ _.epub"') || cd.includes('filename="Tutsag'), 'ascii fallback name')
ok(cd.includes("filename*=UTF-8''Tutsa%C4%9F%C4%B1"), 'utf-8 name kept')
console.log(`verify-kobo-feed: ${n} assertions passed`)
