'use strict'
// Database functions (POST /rest/v1/rpc/<name>) the pages call while they load.
// Each answer has the real function's shape, worked out from the made-up rows.
// A function missing here answers [] (postgrest.cjs) and HARNESS_LOG=1 names it.
// Writes made through an RPC (saving an item, ticking a repeat's day) are not
// simulated unless a test needed one (Needs a look's three, Shop's sale and
// delete with their Undo): add an answer here when a test needs one.

const { randomUUID } = require('node:crypto')

const DAY_MS = 864e5

/**
 * 190: one Needs-a-look row's state written as the real functions do — the row before and after, so the app's
 * Undo can write `before` back. `change` maps the row (a new one when there is none) to what it becomes, or null.
 */
function signalWrite(store, itemId, signal, change, subject = null) {
  const rows = (store.tables.shop_signal_states ??= [])
  const key = r => r.signal === signal && (r.item_id ?? null) === (itemId ?? null) && (r.subject ?? null) === (subject ?? null)
  const at = rows.findIndex(key)
  const before = at >= 0 ? rows[at] : null
  const now = new Date().toISOString()
  const fresh = { id: randomUUID(), user_id: store.ownerId, item_id: itemId ?? null, signal, subject: subject ?? null, signature: null, snoozed_until: null, dismissed_at: null, created_at: now, updated_at: now }
  const next = change(before ?? fresh)
  if (!next) {
    if (at >= 0) rows.splice(at, 1)
    return { before, after: null }
  }
  const after = { ...next, updated_at: now }
  if (at >= 0) rows[at] = after
  else rows.push(after)
  return { before, after }
}

/** 191's resets: the row's facts become its source's again; answers the row before and after. */
function resetToSource(store, table, id) {
  const row = store.rows(table).find(r => r.id === id)
  if (!row || !row.source_facts) return { before: null, after: null }
  const before = { ...row }
  Object.assign(row, row.source_facts, { owner_edited: false, edited_at: null, updated_at: new Date().toISOString() })
  return { before, after: { ...row } }
}

const RPCS = {
  // 190: Needs a look's price figures from the clean reads (condition new or unknown), as shop_price_stats answers.
  shop_price_stats: (args, store) => {
    const ids = new Set(args.p_item_ids || [])
    const now = Date.now()
    const byItem = new Map()
    for (const p of store.rows('shop_price_points')) if (ids.has(p.item_id)) byItem.set(p.item_id, [...(byItem.get(p.item_id) || []), p])
    const out = []
    for (const [id, all] of byItem) {
      const points = all.slice().sort((a, b) => a.checked_at.localeCompare(b.checked_at))
      const clean = points.filter(p => p.condition === 'new' || p.condition === 'unknown')
      if (!clean.length) continue
      const last = clean[clean.length - 1]
      const currency = last.currency || null
      const same = clean.filter(p => (p.currency || null) === currency)
      const in60 = same.filter(p => now - Date.parse(p.checked_at) <= 60 * DAY_MS)
      const lows = same.map(p => Number(p.low)), lows60 = in60.map(p => Number(p.low))
      const stock = points.filter(p => typeof p.in_stock === 'boolean')
      const lastStock = stock[stock.length - 1]
      const back = !!lastStock && lastStock.in_stock && stock.some(p => p.in_stock === false && now - Date.parse(p.checked_at) <= 30 * DAY_MS)
      const lastOut = stock.map(p => p.in_stock).lastIndexOf(false)
      const spark = Array.from({ length: 12 }, (_, k) => {
        const from = now - (60 - 5 * k) * DAY_MS, to = from + 5 * DAY_MS
        const step = in60.filter(p => { const t = Date.parse(p.checked_at); return t >= from && t < to }).map(p => Number(p.low))
        return step.length ? Math.min(...step) : null
      })
      out.push({
        item_id: id, currency, points: same.length, low_all: Math.min(...lows), high_all: Math.max(...lows), points_60d: in60.length,
        first_60d: in60.length ? in60[0].checked_at : null,
        low_60d: lows60.length ? Math.min(...lows60) : null, high_60d: lows60.length ? Math.max(...lows60) : null,
        last_price: Number(last.low), last_in_stock: lastStock ? lastStock.in_stock : null, last_at: last.checked_at,
        back_in_stock: back, restocked_at: back ? stock[lastOut + 1]?.checked_at ?? null : null, spark,
      })
    }
    return out
  },
  // 190: Snooze (a Got it stays), Got it (it ends a snooze) and Undo / Show again (the state written back exactly, or none).
  shop_signal_snooze: (a, store) => signalWrite(store, a.p_item_id, a.p_signal, s => ({ ...s, snoozed_until: a.p_until }), a.p_subject),
  shop_signal_dismiss: (a, store) => signalWrite(store, a.p_item_id, a.p_signal, s => ({ ...s, signature: a.p_signature, dismissed_at: new Date().toISOString(), snoozed_until: null }), a.p_subject),
  shop_signal_put: (a, store) => signalWrite(store, a.p_item_id, a.p_signal, s => (a.p_state ? { ...s, ...a.p_state } : null), a.p_subject),

  // 137/187: a sale as one call — the thing and the accessories sold with it get the disposal facts (each its own
  // share), kept accessories move or stand alone, the money may go to another thing; what Undo needs is kept on
  // the row (`sale_undo`, as 187 does). Rates: NOK only (fx 1), else pending.
  shop_record_sale: (a, store) => {
    const items = store.tables.shop_items ?? []
    const rows = a.p_rows ?? []
    const group = rows.length > 1 ? randomUUID() : null
    const fields = ['disposal', 'disposed_on', 'sale_price', 'sale_currency', 'sale_fx_nok', 'sale_fx_source', 'sold_to', 'sale_group', 'accessory_of']
    for (const r of rows) {
      const it = items.find(i => i.id === r.id)
      if (!it) continue
      const before = Object.fromEntries(fields.map(f => [f, it[f] ?? null]))
      Object.assign(it, {
        disposal: a.p_disposal, disposed_on: a.p_on, sale_price: r.sale_price, sale_currency: a.p_currency,
        sale_fx_nok: a.p_currency === 'NOK' ? 1 : null, sale_fx_source: a.p_currency === 'NOK' ? 'fixed' : null,
        sold_to: a.p_sold_to ?? null, sale_group: group, sale_undo: { row: before, keep: [], link: null }, updated_at: new Date().toISOString(),
      })
    }
    const first = items.find(i => i.id === rows[0]?.id)
    for (const k of a.p_keep ?? []) {
      const acc = items.find(i => i.id === k.id)
      if (!acc) continue
      first?.sale_undo.keep.push({ id: acc.id, accessory_of: acc.accessory_of ?? null })
      acc.accessory_of = k.move_to ?? null
    }
    // 192: the sale closes the thing's open listing — Sold, or Withdrawn when it went another way.
    for (const l of store.tables.shop_listings ?? []) {
      if (l.item_id === first?.id && (l.status === 'listed' || l.status === 'for_sale')) {
        Object.assign(l, { status: a.p_disposal === 'sold' ? 'sold' : 'withdrawn', ended_on: a.p_on, closed_by_sale: true, updated_at: new Date().toISOString() })
      }
    }
    if (a.p_to && first) {
      const link = { id: randomUUID(), user_id: store.ownerId, from_id: first.id, to_id: a.p_to, amount: a.p_to_amount ?? null, created_at: new Date().toISOString() }
      ;(store.tables.shop_item_links ??= []).push(link)
      first.sale_undo.link = link.id
    }
    return null
  },
  shop_undo_sale: (a, store) => {
    const items = store.tables.shop_items ?? []
    const it = items.find(i => i.id === a.p_id)
    if (!it || !it.sale_undo) return null
    const undo = it.sale_undo
    const together = it.sale_group ? items.filter(i => i.sale_group === it.sale_group) : [it]
    for (const r of together) { if (r.sale_undo) Object.assign(r, r.sale_undo.row, { sale_undo: null }) }
    for (const k of undo.keep) { const acc = items.find(i => i.id === k.id); if (acc) acc.accessory_of = k.accessory_of }
    if (undo.link) store.tables.shop_item_links = (store.tables.shop_item_links ?? []).filter(l => l.id !== undo.link)
    // 192: the listing the sale closed opens again as it was.
    for (const l of store.tables.shop_listings ?? []) {
      if (l.item_id === it.id && l.closed_by_sale) Object.assign(l, { status: l.for_sale_on ? 'for_sale' : 'listed', ended_on: null, closed_by_sale: false })
    }
    return null
  },
  // 192: the default templates and checklists an account lacks (the harness has them all: none added).
  shop_add_resale_defaults: () => 0,
  // 187: Delete answers the snapshot its Undo puts back (the owner's rows by id, their links and costs); restore
  // writes it back. Children are the accessories the app sends along (deleteScope).
  shop_delete_items: (a, store) => {
    const ids = new Set(a.p_ids ?? [])
    const take = (name, hit) => {
      const all = store.tables[name] ?? []
      const out = all.filter(r => r.user_id === store.ownerId && hit(r))
      store.tables[name] = all.filter(r => !out.includes(r))
      return out
    }
    return {
      items: take('shop_items', r => ids.has(r.id)),
      links: take('shop_item_links', r => ids.has(r.from_id) || ids.has(r.to_id)),
      costs: take('shop_item_costs', r => ids.has(r.item_id)),
      children: [],
    }
  },
  shop_restore_items: (a, store) => {
    const s = a.p_snapshot ?? {}
    for (const [name, key] of [['shop_items', 'items'], ['shop_item_links', 'links'], ['shop_item_costs', 'costs']]) {
      const rows = (store.tables[name] ??= [])
      for (const r of s[key] ?? []) if (!rows.some(x => x.id === r.id)) rows.push(r)
    }
    return null
  },
  // 191: a rule or a store back to its source — the row before and after (the facts from source_facts, not edited).
  shop_store_rule_reset: (a, store) => resetToSource(store, 'shop_store_rules', a.p_id),
  shop_store_reset: (a, store) => resetToSource(store, 'shop_stores', a.p_id),

  // 144: the one delete with Undo — only the rows themselves (nothing deleted with them is simulated); NULL when none was there.
  app_delete_rows: (a, store) => {
    const ids = new Set(a.p_ids ?? [])
    const all = store.tables[a.p_table] ?? []
    const rows = all.filter(r => ids.has(r.id))
    if (!rows.length) return null
    store.tables[a.p_table] = all.filter(r => !ids.has(r.id))
    return { v: 1, root: a.p_table, deleted: rows.length, groups: [{ table: a.p_table, pk: 'id', rows }], links: [], touched: [], hidden: [] }
  },

  // 156: the app's own run of the day's repeats. The made-up data already holds today's tasks.
  app_repeat_days_today: (args) => ({ missed: 0, created: 0, skipped: 0, failed: 0, today: args.p_today ?? null }),

  // 155: Settings' "Convert old items" preview — nothing old to convert.
  app_convert_preview: () => ({ futureStandaloneBlocks: 0, pastStandaloneBlocks: 0, plans: 0, tasksWithSlots: 0, autoClearedEpisodes: 0, examples: [] }),

  // 180: the owner's own task labels, most used first.
  app_task_labels: (args, store) => {
    const uses = new Map()
    for (const t of store.rows('tasks')) for (const l of t.labels || []) uses.set(l, (uses.get(l) || 0) + 1)
    return [...uses].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, n]) => ({ label, uses: n }))
  },
}

module.exports = { RPCS }
