'use strict'
// Database functions (POST /rest/v1/rpc/<name>) the pages call while they load.
// Each answer has the real function's shape, worked out from the made-up rows.
// A function missing here answers [] (postgrest.cjs) and HARNESS_LOG=1 names it.
// Writes made through an RPC (saving an item, ticking a repeat's day) are not
// simulated: add an answer here when a test needs one.

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
