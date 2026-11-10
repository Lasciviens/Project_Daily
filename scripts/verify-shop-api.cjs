#!/usr/bin/env node
/* Verification — Shop's reads and its edit (src/features/shop/api/shopApi.ts, 09.11.2026), run on the
 * real module over an in-memory PostgREST stand-in (eq, the `or` forms shopApi sends, order, range,
 * limit, and the server's 1,000-row cap):
 *   1. Daily's Shopping card reads only QUICK_ROW_COLUMNS of the rows that can be on the quick list
 *      (fetchQuickRows) and runs the Shop page's own rules on them (shopModel.quickDue /
 *      quickFromWishlist, through useQuickToPickUp). The rules must read no other column — one they
 *      start reading would be missing on Daily, which would then quietly disagree with the page — and
 *      the narrow read must give the page's answer: the same rows in the same order.
 *   2. Every open-ended read takes page after page in one total order (a unique column last).
 *   3. A row's price history is its newest reads, oldest first: the line reaches the last check.
 *   4. updateShopItem is scoped to the user and reads its row back; a row that isn't there (or is
 *      someone else's) is an error, never a silent no-op.
 *   5. Needs a look's data (shopSignalsApi.ts, migration 190): the price figures of many things go out as one
 *      call per 500 ids, each id once; before 190 the reads answer nothing and a write says so by name; a
 *      signature or a day the database would refuse is refused here first; an Undo sends the row's own fields.
 * Run: node scripts/verify-shop-api.cjs */
require('sucrase/register')
const fs = require('fs')
const path = require('path')
const Module = require('module')

let passed = 0, failed = 0
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) } else { failed++; console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`) }
}

// ── The stand-in ─────────────────────────────────────────────────────────────
const MAX_ROWS = 1000
const tables = {}
const calls = []
function from(table) {
  const st = { table, op: 'select', cols: '*', returning: false, eqs: [], ors: null, preds: [], orders: [], range: null, limit: null, patch: null }
  const b = {
    select(cols = '*') { if (st.op === 'select') st.cols = cols; else st.returning = true; return b },
    update(patch) { st.op = 'update'; st.patch = patch; return b },
    eq(c, v) { st.eqs.push([c, v]); st.preds.push(r => r[c] === v); return b },
    // PostgREST's or=(a.eq.x,b.is.true,…) — the flat forms shopApi sends.
    or(expr) {
      st.ors = expr
      const parts = expr.split(',').map(p => {
        const [c, op, ...rest] = p.split('.')
        const v = rest.join('.')
        if (op === 'eq') return r => r[c] != null && String(r[c]) === v
        if (op === 'is') return r => r[c] === (v === 'true' ? true : v === 'false' ? false : null)
        throw new Error(`the stand-in does not know or-filter "${p}"`)
      })
      st.preds.push(r => parts.some(f => f(r)))
      return b
    },
    order(c, o = {}) { st.orders.push([c, o.ascending !== false]); return b },
    range(f, t) { st.range = [f, t]; return b },
    limit(n) { st.limit = n; return b },
    overrideTypes() { return b },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej) },
  }
  const cmp = (a, b2) => {
    for (const [c, asc] of st.orders) {
      const x = a[c] ?? '', y = b2[c] ?? ''
      if (x < y) return asc ? -1 : 1
      if (x > y) return asc ? 1 : -1
    }
    return 0
  }
  function run() {
    calls.push(st)
    if (failing[table]) return { data: null, error: failing[table] }
    const rows = (tables[table] ??= [])
    const hit = rows.filter(r => st.preds.every(p => p(r)))
    if (st.op === 'update') {
      for (const r of hit) Object.assign(r, st.patch)
      return { data: st.returning ? hit.map(r => ({ ...r })) : null, error: null }
    }
    let out = [...hit].sort(cmp)
    if (st.range) out = out.slice(st.range[0], st.range[1] + 1)
    if (st.limit != null) out = out.slice(0, st.limit)
    out = out.slice(0, MAX_ROWS)
    if (st.cols !== '*') {
      const keep = st.cols.split(',').map(s => s.trim())
      out = out.map(r => Object.fromEntries(keep.map(k => [k, r[k]])))
    } else out = out.map(r => ({ ...r }))
    return { data: out, error: null }
  }
  return b
}

const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, parent, ...rest) {
  if (/integrations\/supabase\/client$/.test(request)) return 'stub:supabase'
  if (/shared\/utils\/requireUser$/.test(request)) return 'stub:requireUser'
  return origResolve.call(this, request, parent, ...rest)
}
// A table the stand-in answers with this error (PostgREST's "not found" before a migration, say).
const failing = {}
// Function calls: each recorded; `rpcAnswer` scripts the answer.
const rpcCalls = []
let rpcAnswer = () => ({ data: null, error: null })
const rpc = async (fn, args) => { rpcCalls.push({ fn, args: JSON.parse(JSON.stringify(args)) }); return rpcAnswer(fn, args) }
require.cache['stub:supabase'] = { id: 'stub:supabase', filename: 'stub:supabase', loaded: true, exports: { supabase: { from, rpc } } }
require.cache['stub:requireUser'] = { id: 'stub:requireUser', filename: 'stub:requireUser', loaded: true, exports: { requireUser: async () => ({ id: 'u' }) } }
const A = require('../src/features/shop/api/shopApi.ts')
const N = require('../src/features/shop/api/shopSignalsApi.ts')
Module._resolveFilename = origResolve
const M = require('../src/features/shop/shopModel')

// A fixed sequence, so a failure can be run again.
let seed = 7
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const pick = a => a[Math.floor(rand() * a.length)]
const stamp = i => new Date(Date.UTC(2026, 0, 1) + i * 3_600_000).toISOString()
const ids = rows => rows.map(r => r.id).join()

;(async () => {
  const COLS = [...A.QUICK_ROW_COLUMNS]
  const today = '2026-11-09'

  console.log('1 · Daily\'s Shopping card: a narrow read, the Shop page\'s rules')
  {
    const full = Array.from({ length: 1500 }, (_, i) => ({
      id: `r${String(i).padStart(4, '0')}`, user_id: 'u', category_id: pick([null, 'c1']), title: `Row ${i}`, notes: pick([null, 'n']),
      price: pick([null, 100]), price_source: null, platform: pick([null, '', '  ', 'Elkjøp', 'Rema 1000']), url: null,
      priority: pick(['low', 'medium', 'high']), region: pick([null, 'NO', 'TR']),
      planned_date: pick([null, '2026-11-01', today, '2026-11-20']), status: pick(['wishlist', 'wishlist', 'bought', 'dropped', 'fulfilled']),
      source_type: 'manual', created_at: stamp(i), updated_at: stamp(i + 1), list: pick(['wishlist', 'quick']), currency: null,
      bought_at: null, task_id: null, kind: pick(['item', 'item', 'general']), option_for: pick([null, null, 'r0001']), accessory_of: null,
      errand: pick([true, false]), wait_for_deal: pick([true, false]), ean: pick([null, '7038010000000']), image_url: null, kept: true,
    }))
    tables.shop_items = full.map(r => ({ ...r }))

    const touched = new Set()
    const spy = r => new Proxy(r, { get(t, k) { if (typeof k === 'string') touched.add(k); return t[k] } })
    M.quickDue(full.map(spy))
    M.quickFromWishlist(full.map(spy), today)
    const outside = [...touched].filter(k => !COLS.includes(k))
    check(`the quick-list rules read only QUICK_ROW_COLUMNS (${COLS.length})`, touched.size > 0 && !outside.length, `also read: ${outside.join(', ')}`)

    calls.length = 0
    const narrow = await A.fetchQuickRows()
    check('the read asks for those columns only, and gets nothing else', calls.every(c => c.cols === COLS.join(', '))
      && narrow.every(r => Object.keys(r).every(k => COLS.includes(k))))
    const want = ids([...M.quickDue(full), ...M.quickFromWishlist(full, today)])
    const got = ids([...M.quickDue(narrow), ...M.quickFromWishlist(narrow, today)])
    check('Daily lists what the Shop page would: the same rows in the same order', want.length > 0 && want === got, `page ${want.split(',').length}, Daily ${got.split(',').length}`)
    check(`…from fewer rows (${narrow.length} of ${full.length}): everything bought, dropped or fulfilled stays behind`,
      narrow.length < full.length && narrow.every(r => r.status === 'wishlist'))

    const card = fs.readFileSync(path.join(__dirname, '../src/features/daily/components/summary/ShopCard.tsx'), 'utf8')
    const shown = [...new Set([...card.matchAll(/\bi\.(\w+)/g)].map(m => m[1]))]
    check(`the card shows only columns the read has (${shown.join(', ')})`, shown.length > 0 && shown.every(k => COLS.includes(k)))
    check('the card reads the narrow hook, never the whole list', /useQuickToPickUp\(/.test(card) && !/useShopItems\(/.test(card))
  }

  console.log('\n2 · Every page of an open-ended read')
  {
    const cases = [
      ['shop_items', A.fetchShopItems, 2345, 'id'],
      ['shop_item_links', A.fetchShopLinks, 2345, 'id'],
      ['shop_item_costs', A.fetchShopCosts, 1000, 'id'],
      ['shop_price_watch', A.fetchPriceWatches, 1001, 'item_id'],
    ]
    for (const [table, read, n, key] of cases) {
      tables[table] = Array.from({ length: n }, (_, i) => ({
        id: `${table}-${String(i).padStart(5, '0')}`, item_id: `item-${String(i).padStart(5, '0')}`, user_id: 'u',
        // Few distinct times and days: ties a page boundary falls inside.
        created_at: stamp(i % 7), spent_on: `2026-0${1 + (i % 9)}-01`, amount: '12.50', fx_nok: null, low: '10', high: null, was: null, prev_low: null,
      }))
      calls.length = 0
      const rows = await read()
      const pages = calls.filter(c => c.table === table)
      const unique = new Set(rows.map(r => r[key]))
      check(`${table}: all ${n} rows in ${Math.ceil((n + 1) / MAX_ROWS)} pages, each once`,
        rows.length === n && unique.size === n && pages.length === Math.ceil((n + 1) / MAX_ROWS), `${rows.length} rows, ${pages.length} pages`)
      check(`${table}: one total order (${key} last)`, pages.every(c => c.orders.length > 0 && c.orders[c.orders.length - 1][0] === key && c.range))
    }
    const link = (await A.fetchShopLinks())[0]
    check('amounts read as numbers', link.amount === 12.5)
  }

  console.log('\n3 · A row\'s price history reaches the last check')
  {
    tables.shop_price_points = [
      ...Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, user_id: 'u', item_id: 'x', checked_at: stamp(i * 24), low: String(1000 - i), high: null, offers: 3, currency: 'NOK', source: 'prisjakt' })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `q${i}`, user_id: 'u', item_id: 'y', checked_at: stamp(i * 24 + 5), low: '7', high: null, offers: 1, currency: 'NOK', source: 'store' })),
    ]
    const pts = await A.fetchPricePoints('x')
    const newest = stamp(999 * 24)
    check('a long history: its newest reads, oldest first, ending at the last check',
      pts.length > 0 && pts.length < 1000 && pts[pts.length - 1].checked_at === newest
      && pts.every((p, i) => i === 0 || pts[i - 1].checked_at < p.checked_at), `${pts.length} points, last ${pts[pts.length - 1]?.checked_at}`)
    check('only that row\'s points, prices as numbers', pts.every(p => p.item_id === 'x' && typeof p.low === 'number'))
    const short = await A.fetchPricePoints('y')
    check('a short history is all there, oldest first', short.length === 5 && short[0].id === 'q0' && short[4].id === 'q4')
  }

  console.log('\n4 · An edit is scoped and says when it changed nothing')
  {
    tables.shop_items = [{ id: 'a', user_id: 'u', title: 'Old' }, { id: 'b', user_id: 'someone', title: 'Theirs' }]
    calls.length = 0
    const row = await A.updateShopItem('a', { title: 'New' })
    const call = calls[calls.length - 1]
    check('scoped by id and user, read back: the stored row', row.title === 'New' && call.returning
      && call.eqs.some(([c, v]) => c === 'id' && v === 'a') && call.eqs.some(([c, v]) => c === 'user_id' && v === 'u'))
    const fails = async (id) => { try { await A.updateShopItem(id, { title: 'x' }); return null } catch (e) { return e } }
    const theirs = await fails('b')
    check('someone else\'s row: nothing changes, and the edit fails', theirs && /^Not saved/.test(theirs.message) && tables.shop_items[1].title === 'Theirs', theirs?.message)
    const gone = await fails('gone')
    check('a row that is gone: an error, never a silent no-op', gone && /^Not saved/.test(gone.message), gone?.message)
  }

  console.log('\n5 · Needs a look\'s data (migration 190)')
  {
    const uuid = k => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
    const stat = id => ({ item_id: id, currency: 'NOK', points: 3, low_all: 900, high_all: 1200, points_60d: 2, low_60d: 900, high_60d: 1000,
      last_price: 950, last_in_stock: true, last_at: '2026-11-09T05:23:00+00:00', back_in_stock: false, restocked_at: null, spark: Array(12).fill(null) })
    const wanted = Array.from({ length: 1100 }, (_, k) => uuid(k))
    rpcCalls.length = 0
    rpcAnswer = (fn, args) => ({ data: args.p_item_ids.map((id, k) => (k === 0 ? { ...stat(id), low_all: 'NaN' } : stat(id))), error: null })
    const stats = await N.fetchPriceStats([...wanted, ...wanted.slice(0, 300), 'not-an-id'])
    check('the figures of 1 100 things: three calls of shop_price_stats (500, 500, 100), every id once, never one call per thing',
      rpcCalls.length === 3 && rpcCalls.every(c => c.fn === 'shop_price_stats') && rpcCalls.map(c => c.args.p_item_ids.length).join() === '500,500,100'
      && new Set(rpcCalls.flatMap(c => c.args.p_item_ids)).size === 1100, rpcCalls.map(c => `${c.fn} ${c.args.p_item_ids?.length}`).join('; '))
    check('…an answer whose price is NaN is left out, the rest are numbers', stats.length === 1097 && stats.every(s => Number.isFinite(s.low_all)))
    rpcCalls.length = 0
    check('no ids: no call', (await N.fetchPriceStats([])).length === 0 && rpcCalls.length === 0)
    rpcAnswer = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.shop_price_stats' } })
    check('before 190 the figures are simply none (the tiles show no bar)', (await N.fetchPriceStats([uuid(1)])).length === 0)
    rpcAnswer = () => ({ data: null, error: { code: '22023', message: 'At most 500 things at a time' } })
    const refused = await N.fetchPriceStats([uuid(1)]).then(() => null, e => e)
    check('…but any other refusal is an error, never "no figures"', refused && /At most 500/.test(refused.message))

    const row = p => ({ id: uuid(9001), user_id: uuid(1), item_id: uuid(5), signal: 'at_target', signature: null, snoozed_until: '2026-11-17', dismissed_at: null,
      created_at: '2026-11-10T09:00:00+00:00', updated_at: '2026-11-10T09:00:00+00:00', ...p })
    rpcCalls.length = 0
    rpcAnswer = () => ({ data: { before: null, after: row() }, error: null })
    const w = await N.snoozeSignal({ item_id: uuid(5), signal: 'at_target', until: '2026-11-17' })
    check('Snooze: one call of shop_signal_snooze with the thing, the signal and the day; the answer\'s before and after',
      rpcCalls.length === 1 && rpcCalls[0].fn === 'shop_signal_snooze' && JSON.stringify(rpcCalls[0].args) === JSON.stringify({ p_item_id: uuid(5), p_signal: 'at_target', p_until: '2026-11-17' })
      && w.before === null && w.after?.snoozed_until === '2026-11-17')
    const no = async f => { rpcCalls.length = 0; const e = await f().then(() => null, x => x); return { e, calls: rpcCalls.length } }
    let r = await no(() => N.snoozeSignal({ item_id: null, signal: 'tidy_up', until: '17.11.2026' }))
    const r2 = await no(() => N.snoozeSignal({ item_id: null, signal: 'made_up', until: '2026-11-17' }))
    const r3 = await no(() => N.dismissSignal({ item_id: null, signal: 'tidy_up', signature: 'two words' }))
    check('a day that is no yyyy-mm-dd, a signal not on the list, a signature the database would refuse: refused here, nothing sent',
      r.e && r.calls === 0 && r2.e && r2.calls === 0 && r3.e && r3.calls === 0, [r.e?.message, r2.e?.message, r3.e?.message].join(' / '))
    rpcAnswer = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.shop_signal_snooze' } })
    r = await no(() => N.snoozeSignal({ item_id: null, signal: 'tidy_up', until: '2026-11-17' }))
    check('before 190 a write says so by name', r.e?.message === N.NEEDS_190, r.e?.message)
    rpcAnswer = () => ({ data: { before: row(), after: null }, error: null })
    rpcCalls.length = 0
    const cleared = await N.clearSignalState({ item_id: uuid(5), signal: 'at_target' })
    check('Show again: shop_signal_put with no state; its answer\'s before is what an Undo writes back',
      rpcCalls[0]?.fn === 'shop_signal_put' && rpcCalls[0].args.p_state === null && cleared.before?.id === uuid(9001) && cleared.after === null)
    rpcCalls.length = 0
    await N.putSignalState({ item_id: uuid(5), signal: 'at_target', state: { ...row(), extra: 'x' } })
    check('an Undo sends the row\'s own fields only (its id, first time, snooze, Got it) — never user_id or updated_at',
      Object.keys(rpcCalls[0]?.args.p_state ?? {}).sort().join() === 'created_at,dismissed_at,id,signature,snoozed_until')

    tables.shop_signal_states = [row(), row({ id: uuid(9002), signal: 'price_match' }), row({ id: uuid(9003), signal: 'old_wish', item_id: null })]
    const states = await N.fetchSignalStates()
    check('the states read back: a signal this app doesn\'t know (a newer database) is left out', states.map(s => s.id).join() === `${uuid(9001)},${uuid(9003)}`)
    failing.shop_signal_states = { code: 'PGRST205', message: 'Could not find the table public.shop_signal_states' }
    failing.shop_deal_days = { code: '42P01', message: 'relation "public.shop_deal_days" does not exist' }
    check('before 190 the states and the deal days read as none', (await N.fetchSignalStates()).length === 0 && (await N.fetchDealDays()).length === 0)
    delete failing.shop_signal_states
    delete failing.shop_deal_days
    tables.shop_deal_days = [
      { id: uuid(1), slug: 'black_friday', name: 'Black Friday', rule_kind: 'nth_weekday', month: 11, day: null, weekday: 4, nth: 4, offset_days: 1, length_days: 1, source_url: null, checked_on: '2026-11-10' },
      { id: uuid(2), slug: 'broken', name: 'Broken', rule_kind: 'fixed', month: 2, day: 30, weekday: null, nth: null, offset_days: 0, length_days: 1, source_url: null, checked_on: '2026-11-10' },
    ]
    check('the deal days read back are whole rules only', (await N.fetchDealDays()).map(d => d.slug).join() === 'black_friday')
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
