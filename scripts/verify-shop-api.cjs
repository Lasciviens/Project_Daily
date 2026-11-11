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
 *   6. The Undo of a category added from a picker's suggestions (shopCategoryApi.removeNewCategory)
 *      moves what was put in it — or in a subcategory under it — to its parent, then removes it;
 *      every read and write is the owner's own rows only.
 *   7. Add the suggested categories (shopCategoryApi.addSuggestedCategories, owner 10.11.2026): exactly the
 *      plan from a fresh read of the owner's own rows — nothing duplicated, the owner's names win, a second tap
 *      writes nothing, a refused second write takes the tops back — and its Undo (removeAddedCategories)
 *      removes only the rows it made, of those only the ones still empty and as made, and names the rest.
 *   8. Stores, their rules, the law and deal days (shopStoresApi.ts, migration 191): every page read, a row the
 *      database wouldn't hold left out; an edit reads its row first, is checked before any write and sends its
 *      facts only (never origin, the source, owner_edited or the seed key), scoped to the owner; its Undo writes
 *      the facts back exactly; a reset is one call; the owner's deal days lie over 190's (one turned off left out),
 *      and their reset and Undo put back exactly what was there; before 191 the reads are empty and a write says so.
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
    insert(rows) { st.op = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b },
    delete() { st.op = 'delete'; return b },
    eq(c, v) { st.eqs.push([c, v]); st.preds.push(r => r[c] === v); return b },
    in(c, vs) { st.eqs.push([c, vs]); st.preds.push(r => vs.includes(r[c])); return b },
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
    maybeSingle() { st.single = true; return b },
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
    const refused = failWhen(st)
    if (refused) return { data: null, error: refused }
    const rows = (tables[table] ??= [])
    if (st.op === 'insert') {
      // A new row gets its id and the database's time, as the table's defaults do.
      // Each row its own id and time, never one used before.
      const made = st.rows.map(r => {
        const at = new Date(Date.UTC(2026, 10, 10, 12) + ++newId).toISOString()
        return { id: `n${newId}`, created_at: at, updated_at: at, ...r }
      })
      rows.push(...made)
      return { data: st.returning ? (st.single ? { ...made[0] } : made.map(r => ({ ...r }))) : null, error: null }
    }
    const hit = rows.filter(r => st.preds.every(p => p(r)))
    if (st.op === 'update') {
      for (const r of hit) Object.assign(r, st.patch)
      if (st.returning && st.single) return { data: hit[0] ? { ...hit[0] } : null, error: null }
      return { data: st.returning ? hit.map(r => ({ ...r })) : null, error: null }
    }
    if (st.op === 'delete') {
      tables[table] = rows.filter(r => !hit.includes(r))
      return { data: null, error: null }
    }
    let out = [...hit].sort(cmp)
    if (st.range) out = out.slice(st.range[0], st.range[1] + 1)
    if (st.limit != null) out = out.slice(0, st.limit)
    out = out.slice(0, MAX_ROWS)
    if (st.cols !== '*') {
      const keep = st.cols.split(',').map(s => s.trim())
      out = out.map(r => Object.fromEntries(keep.map(k => [k, r[k]])))
    } else out = out.map(r => ({ ...r }))
    if (st.single) return { data: out[0] ?? null, error: null }
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
// A request the stand-in refuses (returns its error, or null to answer it).
let failWhen = () => null
let newId = 0
// Function calls: each recorded; `rpcAnswer` scripts the answer.
const rpcCalls = []
let rpcAnswer = () => ({ data: null, error: null })
const rpc = async (fn, args) => { rpcCalls.push({ fn, args: JSON.parse(JSON.stringify(args)) }); return rpcAnswer(fn, args) }
require.cache['stub:supabase'] = { id: 'stub:supabase', filename: 'stub:supabase', loaded: true, exports: { supabase: { from, rpc } } }
require.cache['stub:requireUser'] = { id: 'stub:requireUser', filename: 'stub:requireUser', loaded: true, exports: { requireUser: async () => ({ id: 'u' }) } }
const A = require('../src/features/shop/api/shopApi.ts')
const C = require('../src/features/shop/api/shopCategoryApi.ts')
const N = require('../src/features/shop/api/shopSignalsApi.ts')
const S = require('../src/features/shop/api/shopStoresApi.ts')
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
    rpcCalls.length = 0
    rpcAnswer = () => ({ data: { before: null, after: row({ item_id: null, signal: 'deal_day', subject: 'black_friday' }) }, error: null })
    await N.snoozeSignal({ item_id: null, signal: 'deal_day', subject: 'black_friday', until: '2026-11-17' })
    check('a deal day\'s Snooze names its deal (p_subject: its slug), so it is snoozed on its own',
      JSON.stringify(rpcCalls[0]?.args) === JSON.stringify({ p_item_id: null, p_signal: 'deal_day', p_subject: 'black_friday', p_until: '2026-11-17' }), JSON.stringify(rpcCalls[0]?.args))
    const r4 = await no(() => N.snoozeSignal({ item_id: null, signal: 'deal_day', subject: 'Black Friday', until: '2026-11-17' }))
    check('…a subject that is no slug is refused here, nothing sent', r4.e && r4.calls === 0)
    rpcAnswer = () => ({ data: { before: { ...row(), snoozed_until: 'soon' }, after: row() }, error: null })
    const odd = await N.snoozeSignal({ item_id: uuid(5), signal: 'at_target', until: '2026-11-17' })
    check('a before row the app can\'t read back is "unknown" (no Undo may delete it), never "none"', odd.before === null && odd.beforeUnknown === true)
    rpcAnswer = () => ({ data: { before: null, after: row() }, error: null })
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

    tables.shop_signal_states = [row(), row({ id: uuid(9002), signal: 'made_up_signal' }), row({ id: uuid(9003), signal: 'old_wish', item_id: null })]
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

  console.log('\n6 · Undo of an added category')
  {
    const T0 = '2026-11-10T10:00:00.000Z', T1 = '2026-11-10T10:00:05.000Z', OLD = '2025-01-01T00:00:00.000Z'
    tables.shop_categories = [
      { id: 'top', user_id: 'u', name: 'Electronics', parent_id: null, created_at: OLD }, { id: 'new', user_id: 'u', name: 'Headphones', parent_id: 'top', created_at: T0 },
      { id: 'newTop', user_id: 'u', name: 'Garden & DIY', parent_id: null, created_at: T0 }, { id: 'under', user_id: 'u', name: 'Tools', parent_id: 'newTop', created_at: T1 },
      { id: 'theirs', user_id: 'someone', name: 'Headphones', parent_id: 'x', created_at: T0 },
      { id: 'kept', user_id: 'u', name: 'Grills', parent_id: 'top', created_at: OLD },
    ]
    tables.shop_items = [
      { id: 'a', user_id: 'u', category_id: 'new' }, { id: 'b', user_id: 'u', category_id: 'top' },
      { id: 'c', user_id: 'u', category_id: 'under' }, { id: 'd', user_id: 'someone', category_id: 'new' },
    ]
    calls.length = 0
    const moved = await C.removeNewCategory('new', 'top', T0)
    const cat = id => tables.shop_categories.find(c => c.id === id)
    const at = id => tables.shop_items.find(i => i.id === id).category_id
    check('a subcategory: what was put in it moves to its top category, and it goes — the answer counts what moved', !cat('new') && at('a') === 'top' && at('b') === 'top'
      && moved.gone && moved.moved === 1, JSON.stringify(moved))
    check('every read and write is scoped to the owner (another account\'s rows stay as they were)',
      calls.every(c => c.eqs.some(([k, v]) => k === 'user_id' && v === 'u')) && at('d') === 'new' && !!cat('theirs'))
    let threw = null
    calls.length = 0
    try { await C.removeNewCategory('top', null, T0) } catch (e) { threw = e }
    check('a category older than the one made ("Electronics" from 2025, asked with the new one\'s time): refused before any write', threw?.message === 'Electronics was there before — nothing was undone'
      && !!cat('top') && !!cat('kept') && calls.every(c => c.op === 'select'), threw?.message)
    tables.shop_categories.push({ id: 'top2', user_id: 'u', name: 'Audio', parent_id: null, created_at: T1 }, { id: 'older', user_id: 'u', name: 'Speakers', parent_id: 'top2', created_at: OLD })
    tables.shop_items.push({ id: 'e', user_id: 'u', category_id: 'older' })
    threw = null
    calls.length = 0
    try { await C.removeNewCategory('top2', null, T1) } catch (e) { threw = e }
    check('…and one holding a subcategory older than itself ("Speakers"): refused before any write — the cascade would take it', threw?.message === 'Speakers was there before — nothing was undone'
      && !!cat('older') && at('e') === 'older' && calls.every(c => c.op === 'select'), threw?.message)
    const top = await C.removeNewCategory('newTop', null, T0)
    check('a top category: what was in it or under it has no category, and it goes', !cat('newTop') && at('c') === null && top.moved === 1)
    threw = null
    let again = null
    try { again = await C.removeNewCategory('newTop', null, T0) } catch (e) { threw = e }
    check('Undo twice: a category already gone is no error (and says so)', threw === null && again?.gone === false, threw?.message)
  }

  console.log('\n7 · Add the suggested categories, and its Undo (owner, 10.11.2026)')
  {
    const T = require('../src/features/shop/shopTaxonomy')
    const K = T.categoryKey
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const OLD = '2025-01-01T00:00:00.000Z'
    const own = (id, name, parent_id = null, created_at = OLD) => ({ id, user_id: 'u', name, parent_id, created_at })
    const start = () => [
      own('e', 'Electronics'), own('ph', 'Phones', 'e'), own('hp', 'Earbuds', 'e'), own('h', 'Home'), own('k', 'kitchen', 'h'),
      // Another account's "Car" and "Garden & DIY": they must not stop the owner's from being made, nor be touched.
      { id: 'o1', user_id: 'someone', name: 'Car', parent_id: null, created_at: OLD }, { id: 'o2', user_id: 'someone', name: 'Garden & DIY', parent_id: null, created_at: OLD },
    ]
    tables.shop_categories = start()
    tables.shop_items = [{ id: 'i1', user_id: 'u', category_id: 'ph' }, { id: 'i2', user_id: 'someone', category_id: 'o1' }]
    const before = JSON.parse(JSON.stringify(tables.shop_categories))
    const mine = () => tables.shop_categories.filter(c => c.user_id === 'u')
    const expected = T.suggestedPlan(mine()).count
    calls.length = 0
    const made = await C.addSuggestedCategories()
    const inserts = calls.filter(c => c.op === 'insert')
    check('it makes exactly the plan worked out from the owner\'s own rows (another account\'s "Car" doesn\'t count)', made.length === expected && expected > 50
      && made.some(r => r.name === 'Car' && !r.parent_id) && made.some(r => r.name === 'Garden & DIY' && !r.parent_id), `${made.length}/${expected}`)
    check('every read is scoped to the owner, every row made carries the owner\'s id', inserts.every(c => c.rows.every(r => r.user_id === 'u'))
      && calls.filter(c => c.op !== 'insert').every(c => c.eqs.some(([k, v]) => k === 'user_id' && v === 'u')) && made.every(r => r.user_id === 'u'))
    check('two writes — the tops, then every subcategory — answered tops first', inserts.length === 2 && inserts[0].rows.every(r => r.parent_id === null)
      && inserts[1].rows.every(r => r.parent_id) && made.findIndex(r => r.parent_id) === made.filter(r => !r.parent_id).length)
    const twice = mine().filter((c, i, a) => a.findIndex(d => (d.parent_id ?? null) === (c.parent_id ?? null) && K(d.name) === K(c.name)) !== i)
    check('nothing is duplicated: no two of the owner\'s categories at one level by the taxonomy\'s name rules', twice.length === 0, twice.map(c => c.name).join())
    check('the owner\'s names win: no Kitchen beside "kitchen", no Headphones beside "Earbuds", no Home & Living beside "Home"',
      !made.some(r => ['Kitchen', 'Headphones', 'Home & Living', 'Electronics', 'Phones'].includes(r.name)) && made.some(r => r.name === 'Furniture' && r.parent_id === 'h'))
    check('every row that was there is as it was (both accounts\')', before.every(b => tables.shop_categories.some(c => JSON.stringify(c) === JSON.stringify(b))))
    check('nothing is suggested after it', T.suggestedPlan(mine()).count === 0)
    calls.length = 0
    const again = await C.addSuggestedCategories()
    check('a second tap makes nothing — no write at all', again.length === 0 && calls.every(c => c.op === 'select'))

    // Since the add: a thing went into one, one was renamed, an older category was moved under one,
    // one id holds a row of another time, and another account's thing points at one.
    const row = name => made.find(r => r.name === name)
    const at = id => tables.shop_categories.find(c => c.id === id)
    tables.shop_items.push({ id: 'i3', user_id: 'u', category_id: row('EV Charging').id }, { id: 'i4', user_id: 'someone', category_id: row('Tyres & Wheels').id })
    at(row('Grills').id).name = 'BBQ & grills'
    at('hp').parent_id = row('Hobby & Games').id
    at(row('Tablets').id).created_at = OLD
    const notMade = tables.shop_categories.filter(c => !made.some(m => m.id === c.id)).map(c => ({ ...c }))
    const items = JSON.stringify(tables.shop_items)
    calls.length = 0
    const r = await C.removeAddedCategories(made)
    const keptNames = r.kept.map(k => k.name).sort()
    check('Undo keeps what is in use or changed since, and names why: EV Charging (a thing in it) and Car, BBQ & grills (renamed) and Garden & DIY, Hobby & Games (Earbuds moved under it), Tablets (not the row made)',
      eq(keptNames, ['BBQ & grills', 'Car', 'EV Charging', 'Garden & DIY', 'Hobby & Games', 'Tablets'])
      && r.kept.find(k => k.name === 'BBQ & grills').why === 'changed' && r.kept.find(k => k.name === 'Tablets').why === 'before'
      && ['EV Charging', 'Car', 'Garden & DIY', 'Hobby & Games'].every(n => r.kept.find(k => k.name === n).why === 'in_use'), JSON.stringify(r.kept))
    check('…and removes every other row it made — Tyres & Wheels too (another account\'s thing is no reason)', r.removed.length === made.length - 6
      && made.filter(m => r.removed.includes(m.id)).every(m => !at(m.id)) && !at(row('Tyres & Wheels').id))
    check('Undo touches only the rows the action made: every other row is as it was, the older Earbuds included', notMade.every(b => JSON.stringify(at(b.id)) === JSON.stringify(b))
      && !!at('hp') && tables.shop_categories.length === notMade.length + 6)
    check('…never moves a thing, and every read and the delete are the owner\'s rows only', JSON.stringify(tables.shop_items) === items && !calls.some(c => c.op === 'update')
      && calls.every(c => c.eqs.some(([k, v]) => k === 'user_id' && v === 'u')) && calls.some(c => c.op === 'delete'))
    check('the toast says what went and what stayed', C.undoneWords(r) === `${made.length - 6} categories removed · 6 kept, in use or changed since: ${r.kept[0].name}, ${r.kept[1].name} + 4 more`, C.undoneWords(r))
    const twiceR = await C.removeAddedCategories(made)
    check('Undo twice: no error, nothing more removed', twiceR.removed.length === 0 && twiceR.gone === made.length - 6 && twiceR.kept.length === 6)

    // The subcategories refused after the tops were made: the tops go again — never half a list.
    tables.shop_categories = start()
    failWhen = st => (st.op === 'insert' && st.rows.some(x => x.parent_id) ? { message: 'refused' } : null)
    let threw = null
    try { await C.addSuggestedCategories() } catch (e) { threw = e }
    failWhen = () => null
    check('a refused second write: the error goes up and the tops just made are taken back', threw?.message === 'refused' && eq(tables.shop_categories, start()), threw?.message)

    check('the words: "34 categories added", "1 category added"', C.addedWords(34) === '34 categories added' && C.addedWords(1) === '1 category added')
    check('…"34 categories removed"; all gone already; one kept', C.undoneWords({ removed: Array(34).fill('x'), gone: 0, kept: [] }) === '34 categories removed'
      && C.undoneWords({ removed: [], gone: 3, kept: [] }) === 'The categories were already gone'
      && C.undoneWords({ removed: ['x'], gone: 0, kept: [{ name: 'Phones', why: 'in_use' }] }) === '1 category removed · 1 kept, in use now: Phones')
  }

  console.log('\n8 · Stores, their rules, the law and deal days (migration 191)')
  {
    const uuid = k => `00000000-0000-4000-8000-${String(k).padStart(12, '0')}`
    const T = '2026-11-10T09:00:00+00:00'
    const storeRow = (k, p = {}) => ({ id: uuid(k), user_id: 'u', seed_key: null, kind: 'shop', name: `Store ${String(k).padStart(4, '0')}`, country: 'NO', currency: 'NOK',
      hosts: [`s${k}.example`], search_url: null, ad_template: null, ad_language: null, member_tier: null, hidden: false, origin: 'owner', source_url: null,
      read_on: null, source_facts: null, owner_edited: true, edited_at: T, created_at: T, updated_at: T, ...p })
    const facts = { kind: 'return', label: null, days: 90, member_tier: null, window_from: null, window_to: null, return_until: null, exclusions: [], payout: null,
      against: null, against_stores: null, words: null, source_url: 'https://www.power.no/x/p-1/', read_on: '2026-11-10', off: false }
    const ruleRow = (k, p = {}) => ({ id: uuid(k), user_id: 'u', store_id: uuid(1), seed_key: 'power_return', origin: 'seed', ...facts, source_facts: facts,
      owner_edited: false, edited_at: null, created_at: T, updated_at: T, ...p })
    tables.shop_stores = [...Array.from({ length: 1203 }, (_, k) => storeRow(k + 1)), storeRow(9000, { hosts: ['https://bad.example'] }), storeRow(9001, { source_url: 'http://x.example/' })]
    calls.length = 0
    const stores = await S.fetchShopStores()
    check('the stores: every page (1 203 rows, 2 pages), one total order (id last); a row with a bad host or an http source is left out',
      stores.length === 1203 && calls.filter(c => c.table === 'shop_stores').length === 2 && calls.every(c => c.orders[c.orders.length - 1][0] === 'id'), `${stores.length}`)
    tables.shop_store_rules = [ruleRow(1), ruleRow(2, { days: 'NaN' }), ruleRow(3, { kind: 'price_match' }), ruleRow(4, { source_url: 'javascript:alert(1)' })]
    const rules = await S.fetchStoreRules()
    check('the rules read back: NaN days, a kind\'s wrong fields, a link that isn\'t https are left out', rules.map(r => r.id).join() === uuid(1) && rules[0].source?.days === 90)
    tables.shop_site_policies = [{ id: 'p1', host: 'finn.no', no_automated_reading: true }, { id: 'p2', host: 'tise.com', no_automated_reading: true },
      { id: 'p3', host: 'old.example', no_automated_reading: false }, { id: 'p4', host: 'not a host', no_automated_reading: true }]
    check('the sites apps may not read: 188\'s hosts that say so (finn.no, tise.com)', (await S.fetchSitePolicyHosts()).join() === 'finn.no,tise.com')

    // An edit: read the row first (scoped), check the patch, send only its facts, answer before and after.
    tables.shop_store_rules = [ruleRow(1), ruleRow(5, { user_id: 'someone' })]
    calls.length = 0
    const ch = await S.updateStoreRule(uuid(1), { days: 60, words: 'Typed from the help centre.', origin: 'seed', source_facts: { days: 365 }, owner_edited: false, seed_key: 'x' })
    const write = calls.find(c => c.op === 'update')
    check('an edit reads the rule first and writes its facts only — never origin, the source, owner_edited or the seed key — scoped by id and user',
      ch.before.days === 90 && ch.after.days === 60 && write && Object.keys(write.patch).sort().join() === 'days,words'
      && calls.every(c => c.eqs.some(([k, v]) => k === 'id' && v === uuid(1)) && c.eqs.some(([k, v]) => k === 'user_id' && v === 'u')), JSON.stringify(write?.patch))
    const refuse = async f => { calls.length = 0; const e = await f().then(() => null, x => x); return { e, writes: calls.filter(c => c.op !== 'select').length } }
    let r = await refuse(() => S.updateStoreRule(uuid(1), { days: 0 }))
    let r2 = await refuse(() => S.updateStoreRule(uuid(1), { source_url: 'http://www.power.no/' }))
    const r3 = await refuse(() => S.updateStoreRule(uuid(1), { days: NaN }))
    check('…days out of bounds, NaN, an http link: refused here before any write', r.e && r.writes === 0 && r2.e?.message === 'The source must be a https link' && r2.writes === 0 && r3.e && r3.writes === 0)
    r = await refuse(() => S.updateStoreRule(uuid(5), { days: 60 }))
    check('…another account\'s rule (or one that is gone): an error, nothing written', r.e?.message === 'That rule is not there any more' && r.writes === 0)
    calls.length = 0
    await S.putStoreRule(ch.before)
    const undo = calls.find(c => c.op === 'update')
    check('Undo writes the rule\'s facts back exactly, with its edit time — never origin, the source, owner_edited, the seed key or the account',
      undo && Object.keys(undo.patch).sort().join() === 'against,against_stores,days,edited_at,exclusions,kind,label,member_tier,off,payout,read_on,return_until,source_url,window_from,window_to,words'
      && undo.patch.days === 90 && undo.patch.words === null && tables.shop_store_rules[0].days === 90, Object.keys(undo?.patch ?? {}).join())
    rpcCalls.length = 0
    rpcAnswer = () => ({ data: { before: ruleRow(1, { days: 60, owner_edited: true, edited_at: T }), after: ruleRow(1) }, error: null })
    const reset = await S.resetStoreRule(uuid(1))
    check('Reset to the source: one call of shop_store_rule_reset with the id; its answer\'s before and after', rpcCalls.length === 1 && rpcCalls[0].fn === 'shop_store_rule_reset'
      && JSON.stringify(rpcCalls[0].args) === JSON.stringify({ p_id: uuid(1) }) && reset.before.days === 60 && reset.after.days === 90 && !reset.after.owner_edited)
    rpcAnswer = () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.shop_store_rule_reset' } })
    r = await refuse(() => S.resetStoreRule(uuid(1)))
    check('before 191 a reset says so by name', r.e?.message === S.NEEDS_191, r.e?.message)

    // A store: the member tier, hosts and links checked before they are sent.
    tables.shop_stores = [storeRow(1, { seed_key: 'elkjop', origin: 'seed', owner_edited: false, edited_at: null, hosts: ['elkjop.no'], search_url: 'https://www.elkjop.no/search?q={q}' })]
    const sc = await S.updateShopStore(uuid(1), { member_tier: 'Kundeklubb', origin: 'owner' })
    check('a store\'s member tier saves; origin is never sent', sc.after.member_tier === 'Kundeklubb' && Object.keys(calls.find(c => c.op === 'update')?.patch ?? {}).join() === 'member_tier')
    r = await refuse(() => S.updateShopStore(uuid(1), { search_url: 'https://attacker.example/?q={q}' }))
    r2 = await refuse(() => S.updateShopStore(uuid(1), { hosts: ['https://elkjop.no'] }))
    check('…a search link on another host, a web address with https://: refused here before any write', r.e && r.writes === 0 && r2.e && r2.writes === 0, `${r.e?.message} / ${r2.e?.message}`)

    // Before 191: the reads are empty, a write names the migration.
    failing.shop_stores = { code: 'PGRST205', message: 'Could not find the table public.shop_stores' }
    failing.shop_store_rules = { code: '42P01', message: 'relation "public.shop_store_rules" does not exist' }
    failing.shop_law_rules = { code: 'PGRST205', message: 'Could not find the table public.shop_law_rules' }
    failing.shop_deal_day_edits = { code: 'PGRST205', message: 'Could not find the table public.shop_deal_day_edits' }
    check('before 191 the stores, rules and law read as none', (await S.fetchShopStores()).length === 0 && (await S.fetchStoreRules()).length === 0 && (await S.fetchLawRules()).length === 0)
    r = await refuse(() => S.updateStoreRule(uuid(1), { days: 60 }))
    check('…an edit says so by name', r.e?.message === S.NEEDS_191, r.e?.message)
    tables.shop_deal_days = [
      { id: uuid(1), slug: 'black_friday', name: 'Black Friday', rule_kind: 'nth_weekday', month: 11, day: null, weekday: 4, nth: 4, offset_days: 1, length_days: 1, source_url: null, checked_on: '2026-11-10' },
      { id: uuid(2), slug: 'singles_day', name: 'Singles\' Day', rule_kind: 'fixed', month: 11, day: 11, weekday: null, nth: null, offset_days: 0, length_days: 1, source_url: null, checked_on: '2026-11-10' },
    ]
    check('…and the deal days are 190\'s alone', (await N.fetchDealDays()).map(d => d.slug).join() === 'black_friday,singles_day')
    for (const t of ['shop_stores', 'shop_store_rules', 'shop_law_rules', 'shop_deal_day_edits']) delete failing[t]

    // Deal days: the owner's own versions over 190's.
    tables.shop_deal_day_edits = [{ id: uuid(11), user_id: 'u', slug: 'singles_day', name: 'Singles\' Day', rule_kind: 'fixed', month: 11, day: 11, weekday: null, nth: null,
      offset_days: 0, length_days: 1, off: true, source_url: null, created_at: T, updated_at: T }]
    calls.length = 0
    const saved = await S.saveDealDayEdit({ slug: 'black_friday', name: ' Black Week ', rule_kind: 'nth_weekday', month: 11, day: 27, weekday: 4, nth: 4, offset_days: -3, length_days: 8 })
    const ins = calls.find(c => c.op === 'insert')
    check('editing Black Friday adds the owner\'s own version (none before): its name trimmed, its slug and account, no day on an n-th weekday rule',
      saved.before === null && saved.after.name === 'Black Week' && ins && ins.rows[0].slug === 'black_friday' && ins.rows[0].user_id === 'u' && ins.rows[0].day === null, JSON.stringify(ins?.rows))
    const counted = await N.fetchDealDays()
    check('Needs a look counts Black Week in Black Friday\'s place; Singles\' Day, turned off, not at all', counted.map(d => `${d.slug}:${d.name}:${!!d.edited}`).join() === 'black_friday:Black Week:true')
    calls.length = 0
    const again = await S.saveDealDayEdit({ slug: 'black_friday', name: 'Black Week', rule_kind: 'nth_weekday', month: 11, day: null, weekday: 4, nth: 4, offset_days: -3, length_days: 9 })
    check('…a second edit updates that version (scoped by its id and the account) and answers the one before', again.before?.length_days === 8 && again.after.length_days === 9
      && calls.some(c => c.op === 'update' && c.eqs.some(([k, v]) => k === 'user_id' && v === 'u')) && !calls.some(c => c.op === 'insert'))
    r = await refuse(() => S.saveDealDayEdit({ slug: 'leap', name: 'Leap', rule_kind: 'fixed', month: 2, day: 29, weekday: null, nth: null, offset_days: 0, length_days: 1 }))
    r2 = await refuse(() => S.saveDealDayEdit({ slug: 'Bad Slug', name: 'x', rule_kind: 'fixed', month: 1, day: 1, weekday: null, nth: null, offset_days: 0, length_days: 1 }))
    const r4 = await refuse(() => S.saveDealDayEdit({ slug: 'fifth', name: 'x', rule_kind: 'nth_weekday', month: 11, day: null, weekday: 4, nth: 5, offset_days: 0, length_days: 1 }))
    check('…29.02, a slug that is none, a 5th weekday: refused here, nothing written', r.e && !r.writes && r2.e && !r2.writes && r4.e && !r4.writes, [r.e?.message, r2.e?.message, r4.e?.message].join(' / '))
    const resetDeal = await S.resetDealDay('black_friday')
    check('Reset: the owner\'s version goes and is the answer (for the Undo); 190\'s Black Friday counts again', resetDeal.before?.name === 'Black Week'
      && (await N.fetchDealDays()).map(d => d.name).join() === 'Black Friday')
    await S.putDealDayEdit('black_friday', resetDeal.before)
    check('…its Undo puts that version back with its own id', tables.shop_deal_day_edits.some(e => e.id === resetDeal.before.id && e.name === 'Black Week'))
    await S.putDealDayEdit('black_friday', null)
    check('…and an Undo of the first edit (nothing before) takes it away', !tables.shop_deal_day_edits.some(e => e.slug === 'black_friday'))
    tables.shop_deal_day_edits.push({ id: uuid(12), user_id: 'u', slug: 'payday_sale', name: 'Payday sale', rule_kind: 'fixed', month: 1, day: 25, weekday: null, nth: null,
      offset_days: 0, length_days: 1, off: false, source_url: null, created_at: T, updated_at: T })
    r = await refuse(() => S.resetDealDay('payday_sale'))
    check('a deal day of the owner\'s own has no app rule to reset to: refused, kept', r.e && !r.writes && tables.shop_deal_day_edits.some(e => e.slug === 'payday_sale'), r.e?.message)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
