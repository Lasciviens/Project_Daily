#!/usr/bin/env node
/* Verification — a project table's "To buy" rows to Shop (src/features/projects/toBuy.ts):
 * which rows count, the amount, the row's own link (web addresses only),
 * the shop row's notes naming the project; duplicates against the quick list
 * are skipped by the shared batch rule (shop/quickBatch).
 * Run: node scripts/verify-project-to-buy.cjs */
require('sucrase/register')
const { toBuyRows, toShopInput, safeWebUrl } = require('../src/features/projects/toBuy')
const { splitNew, foldedTitles } = require('../src/features/shop/quickBatch')
let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}
const col = (key, label, type, options) => ({ key, label, type, ...(options ? { options } : {}) })
const block = (columns, kind = 'table') => ({ kind, settings: { columns } })
const parts = block([col('part', 'Part', 'text'), col('qty', 'Qty', 'number'), col('state', 'Status', 'status', ['In hand', 'To buy', 'Ordered']), col('link', 'Shop link', 'link')])
let n = 0
const row = (data, sort_order = n) => ({ id: `e${++n}`, data, sort_order, created_at: `2026-11-0${(n % 9) + 1}T10:00:00Z` })

console.log('which rows')
let rows = [row({ part: 'Load cell', qty: 2, state: 'To buy' }), row({ part: 'ESP32', state: 'In hand' }), row({ part: 'HX711', state: 'Ordered' }), row({ part: 'Screws', state: 'To buy' })]
let r = toBuyRows(parts, rows)
check('only To buy rows', r.map(x => x.title).join() === 'Load cell,Screws', r.map(x => x.title).join())
check('quantity read from the Qty column', r[0].quantity === 2 && r[1].quantity === null)
check('a table with no To buy choice gives nothing', toBuyRows(block([col('part', 'Part', 'text'), col('state', 'Status', 'status', ['Bought', 'Owned'])]), rows).length === 0)
check('a table with no choice column gives nothing', toBuyRows(block([col('part', 'Part', 'text')]), rows).length === 0)
check('a log block gives nothing', toBuyRows(block([], 'log'), rows).length === 0)
check('the choice is found in any case', toBuyRows(block([col('a', 'Item', 'text'), col('s', 'Status', 'status', ['TO BUY'])]), [row({ a: 'Paint', s: 'TO BUY' })]).length === 1)
check('a row with no name is left out', toBuyRows(parts, [row({ state: 'To buy' })]).length === 0)
check('order follows the table (sort order)', toBuyRows(parts, [row({ part: 'B', state: 'To buy' }, 2), row({ part: 'A', state: 'To buy' }, 1)]).map(x => x.title).join() === 'A,B')
check('odd settings JSON gives nothing, never throws', toBuyRows({ kind: 'table', settings: null }, rows).length === 0 && toBuyRows({ kind: 'table', settings: { columns: 'x' } }, rows).length === 0)
check('a zero or negative quantity is none', toBuyRows(parts, [row({ part: 'X', qty: 0, state: 'To buy' }), row({ part: 'Y', qty: -1, state: 'To buy' })]).every(x => x.quantity === null))

console.log('the link')
check('https link kept', safeWebUrl('https://example.com/p/1') === 'https://example.com/p/1')
check('javascript: refused', safeWebUrl('javascript:alert(1)') === null)
check('a link with a password refused', safeWebUrl('https://user:pw@example.com/') === null)
check('text that is not an address refused', safeWebUrl('example.com') === null && safeWebUrl(5) === null && safeWebUrl('') === null)
r = toBuyRows(parts, [row({ part: 'Cell', state: 'To buy', link: 'https://example.com/cell' }), row({ part: 'Bad', state: 'To buy', link: 'javascript:1' })])
check('row link carried, bad link dropped', r[0].url === 'https://example.com/cell' && r[1].url === null)

console.log('the shop row')
let s = toShopInput({ entryId: 'e', title: 'Load cell', quantity: 2, url: null }, 'Kitchen scale')
check('notes name the amount and the project', s.notes === '×2 · for Kitchen scale' && s.title === 'Load cell' && s.list === 'quick', JSON.stringify(s))
check('no amount → just the project', toShopInput({ entryId: 'e', title: 'Screws', quantity: null, url: null }, 'Kitchen scale').notes === 'for Kitchen scale')

console.log('duplicates')
const inputs = toBuyRows(parts, rows).map(x => toShopInput(x, 'Kitchen scale'))
const { fresh, skipped } = splitNew(inputs, foldedTitles(['screws']))
check('one already on the list is skipped', fresh.map(x => x.title).join() === 'Load cell' && skipped.length === 1)
check('sending twice adds nothing the second time', splitNew(inputs, foldedTitles(fresh.map(x => x.title).concat(['Screws']))).fresh.length === 0)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
