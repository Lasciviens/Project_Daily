#!/usr/bin/env node
/*
 * Verification — Merge of two book rows (`mergeBooks`, src/features/books/api/libraryApi.ts)
 * against an in-memory PostgREST that behaves like ours where it matters: at
 * most 1,000 rows per answer, the unique key (book, page, started_at) and
 * `reading_page_events.book_id … ON DELETE CASCADE` (126).
 *
 * Why: the merge read each book's events with `.limit(100000)` (still 1,000),
 * moved those, then deleted the loser — the cascade took every event past the
 * first 1,000 with it (audit, 28.10.2026).
 *
 * Run: node scripts/verify-book-merge.cjs
 */
require('sucrase/register')
const Module = require('module')

const MAX_ROWS = 1000
let tables = {}
let afterUpdate = null

function builder(table) {
  const filters = []
  const orders = []
  let op = 'select', patch = null, rng = null, lim = null, head = false, counted = false
  const rows = () => (tables[table] = tables[table] || [])
  const fail = (code, message) => Promise.resolve({ data: null, error: { code, message }, count: null })
  const q = {
    select(_cols, opts = {}) { if (op === 'select') { head = !!opts.head; counted = opts.count === 'exact' } return q },
    update(p) { op = 'update'; patch = p; return q },
    delete() { op = 'delete'; return q },
    eq(c, v) { filters.push(r => r[c] === v); return q },
    in(c, vs) { filters.push(r => vs.includes(r[c])); return q },
    order(c, o = {}) { orders.push([c, o.ascending !== false]); return q },
    range(a, b) { rng = [a, b]; return q },
    limit(n) { lim = n; return q },
    then(res, rej) { return run().then(res, rej) },
  }
  function run() {
    const hit = rows().filter(r => filters.every(f => f(r)))
    if (op === 'update') {
      if (table === 'reading_page_events' && 'book_id' in patch) {
        const key = r => `${r.book_id}|${r.page}|${Date.parse(r.started_at)}`
        const others = new Set(rows().filter(r => !hit.includes(r)).map(key))
        if (hit.some(r => others.has(key({ ...r, ...patch })))) return fail('23505', 'duplicate key value violates unique constraint')
      }
      for (const r of hit) Object.assign(r, patch)
      if (afterUpdate) afterUpdate(table)
      return Promise.resolve({ data: null, error: null })
    }
    if (op === 'delete') {
      tables[table] = rows().filter(r => !hit.includes(r))
      if (table === 'books') tables.reading_page_events = (tables.reading_page_events || []).filter(e => !hit.some(b => b.id === e.book_id))
      return Promise.resolve({ data: null, error: null })
    }
    const out = hit.slice().sort((a, b) => {
      for (const [c, asc] of orders) { if (a[c] === b[c]) continue; return (a[c] < b[c] ? -1 : 1) * (asc ? 1 : -1) }
      return 0
    })
    let page = rng ? out.slice(rng[0], rng[1] + 1) : out
    if (lim != null) page = page.slice(0, lim)
    page = page.slice(0, MAX_ROWS)
    return Promise.resolve({ data: head ? null : page, error: null, count: counted ? hit.length : null })
  }
  return q
}

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (/integrations\/supabase\/client$/.test(request)) return 'stub:supabase'
  if (/shared\/utils\/requireUser$/.test(request)) return 'stub:requireUser'
  return origResolve.call(this, request, parent, ...rest)
}
require.cache['stub:supabase'] = { id: 'stub:supabase', filename: 'stub:supabase', loaded: true, exports: { supabase: { from: builder } } }
require.cache['stub:requireUser'] = { id: 'stub:requireUser', filename: 'stub:requireUser', loaded: true, exports: { requireUser: async () => ({ id: 'u' }) } }
const { mergeBooks } = require('../src/features/books/api/libraryApi.ts')
Module._resolveFilename = origResolve

let n = 0
const failures = []
const ok = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) n++
  else failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`)
}

const book = (id, extra = {}) => ({ id, title: 'Den store boka', author: 'Ola Nordmann', koreader_md5: null, kobo_content_id: null, file_path: null, ...extra })
const T0 = Date.parse('2026-09-01T18:00:00Z')
let nextId = 1
const ev = (bookId, page, minute) => ({ id: nextId++, book_id: bookId, page, started_at: new Date(T0 + minute * 60000).toISOString(), duration_seconds: 55 })
const on = id => tables.reading_page_events.filter(e => e.book_id === id).length
const bookIds = () => tables.books.map(b => b.id)

async function main() {
  // 1. A 1,200-page book read on the Kobo merged into a hand-added row with 50 events.
  tables = { books: [book('survivor'), book('loser', { koreader_md5: 'abc' })], reading_page_events: [] }
  for (let p = 1; p <= 1200; p++) tables.reading_page_events.push(ev('loser', p, p))
  for (let p = 1; p <= 50; p++) tables.reading_page_events.push(ev('survivor', p, -2000 + p))
  await mergeBooks(tables.books[0], tables.books[1])
  ok([on('survivor'), on('loser'), tables.reading_page_events.length], [1250, 0, 1250], 'every event past the first 1,000 moves too')
  ok(bookIds(), ['survivor'], 'the duplicate row is deleted')
  ok(tables.books[0].koreader_md5, 'abc', 'the Kobo key moves to the survivor')

  // 2. The survivor already holds 1,200 events; the loser has 30 of them again
  //    (past the survivor's first 1,000) and 20 of its own. The duplicates are
  //    dropped, never moved into the unique key.
  tables = { books: [book('survivor'), book('loser')], reading_page_events: [] }
  for (let p = 1; p <= 1200; p++) tables.reading_page_events.push(ev('survivor', p, p))
  for (let p = 1171; p <= 1200; p++) tables.reading_page_events.push(ev('loser', p, p))
  for (let p = 1; p <= 20; p++) tables.reading_page_events.push(ev('loser', p, 5000 + p))
  await mergeBooks(tables.books[0], tables.books[1])
  ok([on('survivor'), tables.reading_page_events.length], [1220, 1220], 'duplicates past the first 1,000 are recognised; the rest moves')
  ok(bookIds(), ['survivor'], 'the merge finishes (no unique-key failure half-way)')

  // 3. An event lands on the loser while the merge runs (a Kobo sync): the
  //    loser is not deleted, so nothing goes with it; Merge again finishes.
  tables = { books: [book('survivor'), book('loser')], reading_page_events: [] }
  for (let p = 1; p <= 10; p++) tables.reading_page_events.push(ev('loser', p, p))
  afterUpdate = t => { if (t === 'reading_page_events') { tables.reading_page_events.push(ev('loser', 11, 11)); afterUpdate = null } }
  const err = await mergeBooks(tables.books[0], tables.books[1]).then(() => null, e => e.message)
  ok(typeof err === 'string' && /still on the duplicate/.test(err), true, 'an unmoved event stops the delete with a plain error')
  ok([bookIds(), on('loser'), on('survivor')], [['survivor', 'loser'], 1, 10], 'the loser and its unmoved event are kept')
  await mergeBooks(tables.books[0], tables.books[1])
  ok([bookIds(), on('survivor')], [['survivor'], 11], 'Merge again moves the rest and deletes the loser')

  // 4. Only duplicates left on the loser: they go with it (the survivor has them).
  tables = { books: [book('survivor'), book('loser')], reading_page_events: [] }
  for (let p = 1; p <= 5; p++) tables.reading_page_events.push(ev('survivor', p, p))
  for (let p = 1; p <= 5; p++) tables.reading_page_events.push(ev('loser', p, p))
  await mergeBooks(tables.books[0], tables.books[1])
  ok([bookIds(), on('survivor'), tables.reading_page_events.length], [['survivor'], 5, 5], 'a loser holding only duplicates is deleted')

  if (failures.length) {
    console.error(failures.map(f => `✗ ${f}`).join('\n'))
    console.log(`\n${n} passed, ${failures.length} failed`)
    process.exit(1)
  }
  console.log(`${n} passed, 0 failed`)
}

main().catch(e => { console.error(e); process.exit(1) })
