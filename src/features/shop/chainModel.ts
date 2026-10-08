// Money chains (migration 137): you sold one thing and put the money towards
// the next. A chain is every thing joined by "Paid with money from …" links —
// each thing as a UNIT with the accessories riding with it (still on it, or
// sold with it in the same sale). Pure — scripts/verify-shop-owned.cjs.
//
// The maths, in plain words: what a sold thing cost you and did not bring
// back (its result) moves on to what its money bought ("you lost 1 000 on the
// RP5, so the RP6 really cost 4 500"). A link's amount says how much of the
// sale went where; links without one share the rest by the receivers' prices.
// Whatever is not passed on ends with the thing (lost, or made, for good).
// So for any chain, exactly:
//   Σ paid − Σ got back = Σ route cost of what you still hold + Σ what ended.
// A link from a thing still yours, or to a wish, is a plan: it moves nothing
// until both sides happened — unless the maths is asked to project it (sell at
// "Could sell for", buy at the price now), which is always marked.
// Unknown is never 0: a missing price or a pending rate makes everything it
// reaches incomplete (an `Amount` with missing / pending counts).

import type { ShopItem, ShopItemLink } from './types'
import {
  add, boughtOn, complete, costOf, gotOf, isMine, isPossession, valueNowOf, known, minus, MISSING, monthsBetween, nokNow, scale, ZERO,
  type Amount, type MoneyCtx,
} from './ownModel'
import { nokPerUnit } from './fx'

// ── Units ────────────────────────────────────────────────────────────────────

export interface Unit {
  /** The main thing's id. */
  id: string
  item: ShopItem
  /** Accessories riding with it. */
  accessories: ShopItem[]
}

/** An accessory rides with its item while both are yours, or when they were sold together. */
export function ridesWith(acc: ShopItem, main: ShopItem): boolean {
  if (acc.accessory_of !== main.id || !isPossession(acc) || !isPossession(main)) return false
  if (!acc.disposal && !main.disposal) return true
  return !!acc.disposal && !!main.disposal && !!acc.sale_group && acc.sale_group === main.sale_group
}

/** Every possession's unit, by the id of each member (an accessory finds its item's unit). */
export function unitsOf(items: readonly ShopItem[]): Map<string, Unit> {
  const byId = new Map(items.map(i => [i.id, i]))
  const out = new Map<string, Unit>()
  for (const i of items) {
    if (!isPossession(i)) continue
    const main = i.accessory_of ? byId.get(i.accessory_of) : undefined
    if (main && ridesWith(i, main)) continue
    out.set(i.id, { id: i.id, item: i, accessories: [] })
  }
  for (const i of items) {
    const main = i.accessory_of ? byId.get(i.accessory_of) : undefined
    if (!main || !ridesWith(i, main)) continue
    const u = out.get(main.id)
    if (!u) continue
    u.accessories.push(i)
    out.set(i.id, u)
  }
  for (const u of new Set(out.values())) u.accessories.sort((a, b) => (boughtOn(a) ?? '').localeCompare(boughtOn(b) ?? '') || a.title.localeCompare(b.title))
  return out
}

const unitRows = (u: Unit) => [u.item, ...u.accessories]

// ── Nodes and edges ──────────────────────────────────────────────────────────

export type NodeState = 'held' | 'gone' | 'wish'

export interface ChainNode {
  id: string
  item: ShopItem
  accessories: ShopItem[]
  /** Yours, sold or gone, or still a wish. In a projection, as if it happened. */
  state: NodeState
  /** A number in this node is not what happened: another price was tried, or a plan was projected. */
  projected: boolean
  /** The unit's cost (paid + extras of the thing and its accessories); a wish: its price now. */
  paid: Amount
  /** Money back (sold or gone); null while held or wished. */
  got: Amount | null
  /** What earlier things pass on (+ a loss, − a profit). */
  carried: Amount
  /** paid + carried — for a thing you hold, its route cost (it can be below 0). */
  basis: Amount
  /** Sold or gone: basis − got — what it cost you in the end (− = a profit). */
  result: Amount | null
  /** The part of the result passed on through links (0…1). */
  passedOn: number
  /** Sold or gone: the part of the result that ends here. */
  ends: Amount | null
  /** Money from earlier sales that went into it. */
  cashIn: Amount
  bought: string | null
  left: string | null
}

export interface ChainEdge {
  id: string
  from: string
  to: string
  amount: number | null
  /** Money already moved: sold → bought. Otherwise a plan. */
  realised: boolean
  /** Counted in this computation (realised, or a projected plan). */
  used: boolean
  /** The part of the source's money (and result) this edge carries, when used. */
  share: number | null
}

export type ChainFlagKind = 'over-allocated' | 'amounts-without-proceeds' | 'nothing-left' | 'equal-split' | 'loop'
export interface ChainFlag { kind: ChainFlagKind; id: string }

export interface Chain {
  /** The oldest thing's id. */
  id: string
  /** Oldest first; wishes last. */
  nodes: ChainNode[]
  edges: ChainEdge[]
  flags: ChainFlag[]
  /** Over things you have or had (not wishes): Σ paid, Σ got back, and Σ paid − Σ got. */
  paid: Amount
  got: Amount
  net: Amount
  /** Every thing has at most one way in and one way out. */
  linear: boolean
  /** Some number is a projection or another price. */
  projected: boolean
  /** The name you gave it (migration 138), or null. */
  name: string | null
}

/** "Try other prices": per node, a different total paid and/or got back in NOK. Nothing is saved. */
export interface ChainOverrides { [nodeId: string]: { paidNok?: number; gotNok?: number } }

export interface ChainOptions {
  overrides?: ChainOverrides
  /** Plans happen: a held thing with a plan is sold at "Could sell for", a wish bought at its price now. */
  project?: boolean
  /** A wish's price now (e.g. its price watch); default: its own price, a general wish's lowest. */
  wishPrice?: (wish: ShopItem) => Amount | null
}

const nodeTime = (n: Pick<ChainNode, 'bought' | 'item' | 'state'>) =>
  `${n.state === 'wish' ? '1' : '0'}|${n.bought ?? '9999'}|${n.item.created_at ?? ''}|${n.item.id}`

function defaultWishPrice(w: ShopItem, ctx: MoneyCtx): Amount {
  const price = w.kind === 'general' ? (w.price_min ?? w.price_max ?? null) : w.price
  return price == null ? MISSING : nokNow(price, w.currency ?? (w.region === 'TR' ? 'TRY' : 'NOK'), ctx.rates)
}

function unitCost(u: Unit, ctx: MoneyCtx): Amount {
  return add(...unitRows(u).map(r => costOf(r, ctx)))
}

/** The unit's money back: the rows that left in its sale (or alone). */
function unitGot(u: Unit): Amount {
  return add(...unitRows(u).map(r => gotOf(r) ?? ZERO))
}

/** The sale's own amount and currency, when every row has one in the same currency. */
function unitGotNative(u: Unit): { amount: number; currency: string } | null {
  let amount = 0
  let currency: string | null = null
  for (const r of unitRows(u)) {
    if (!r.disposal) continue
    if (r.sale_price == null) return null
    const c = r.sale_currency ?? r.currency ?? 'NOK'
    if (currency && c !== currency) return null
    currency = c
    amount += r.sale_price
  }
  return currency ? { amount, currency } : null
}

// ── The maths ────────────────────────────────────────────────────────────────

interface Work {
  node: ChainNode
  /** The money back in its own currency (one currency only), for a link amount's share without a rate. */
  native: { amount: number; currency: string } | null
  /** A link amount from this thing is in this currency (its sale's, else its "Could sell for"'s), at this NOK rate. */
  amountCurrency: string
  amountRate: number | null
}

function compute(work: Map<string, Work>, edges: ChainEdge[], flags: ChainFlag[]): void {
  const nodes = [...work.values()].map(w => w.node)
  const usable = (e: ChainEdge) => {
    const u = work.get(e.from)?.node, v = work.get(e.to)?.node
    return !!u && !!v && u.state === 'gone' && v.state !== 'wish'
  }
  for (const e of edges) e.used = usable(e)
  const used = edges.filter(e => e.used)
  const out = new Map<string, ChainEdge[]>(nodes.map(n => [n.id, []]))
  const ins = new Map<string, ChainEdge[]>(nodes.map(n => [n.id, []]))
  for (const e of used) { out.get(e.from)?.push(e); ins.get(e.to)?.push(e) }

  // Shares per sold thing over its used links: amounts first, the rest by the receivers' prices.
  for (const n of nodes) {
    const outs = out.get(n.id) ?? []
    if (n.state !== 'gone' || !outs.length) continue
    const w = work.get(n.id) as Work
    const explicit = outs.filter(e => e.amount != null)
    const implicit = outs.filter(e => e.amount == null)
    let usedShare = 0
    // The share of a link amount: in the sale's own currency when it has one, else in NOK.
    const nativeTotal = w.native && w.native.currency === w.amountCurrency && w.native.amount > 0 ? w.native.amount : null
    const nokTotal = n.got && complete(n.got) && n.got.nok > 0 && w.amountRate ? n.got.nok : null
    const shareOf = (amount: number) => (nativeTotal != null ? amount / nativeTotal : nokTotal != null ? (amount * (w.amountRate as number)) / nokTotal : null)
    if (explicit.length && (nativeTotal != null || nokTotal != null)) {
      const raw = explicit.map(e => shareOf(e.amount as number) as number)
      const sum = raw.reduce((s, x) => s + x, 0)
      const k = sum > 1 + 1e-9 ? 1 / sum : 1
      if (k !== 1) flags.push({ kind: 'over-allocated', id: n.id })
      explicit.forEach((e, i) => { e.share = raw[i] * k })
      usedShare = Math.min(sum, 1)
    } else if (explicit.length) {
      flags.push({ kind: 'amounts-without-proceeds', id: n.id })
      implicit.push(...explicit)
    }
    const rest = 1 - usedShare
    if (implicit.length && rest <= 1e-9) {
      flags.push({ kind: 'nothing-left', id: n.id })
      for (const e of implicit) e.share = 0
    } else if (implicit.length) {
      const weights = implicit.map(e => work.get(e.to)?.node.paid)
      const ok = weights.every(x => !!x && complete(x) && x.nok > 0)
      if (!ok && implicit.length > 1) flags.push({ kind: 'equal-split', id: n.id })
      const sum = ok ? weights.reduce((s, x) => s + (x as Amount).nok, 0) : implicit.length
      implicit.forEach((e, i) => { e.share = (rest * (ok ? (weights[i] as Amount).nok : 1)) / sum })
    }
  }

  // Kahn's order, oldest first among the ready ones; a loop (refused by the database) keeps its own numbers.
  const indeg = new Map(nodes.map(n => [n.id, (ins.get(n.id) ?? []).length]))
  const ready = nodes.filter(n => indeg.get(n.id) === 0).sort((a, b) => nodeTime(a).localeCompare(nodeTime(b)))
  const done = new Set<string>()
  const settle = (n: ChainNode) => {
    done.add(n.id)
    let carried = ZERO
    let cashIn = ZERO
    for (const e of ins.get(n.id) ?? []) {
      const src = work.get(e.from)?.node
      if (!src || !done.has(src.id) || src.result == null || src.got == null) continue
      carried = add(carried, scale(src.result, e.share ?? 0))
      cashIn = add(cashIn, scale(src.got, e.share ?? 0))
    }
    n.carried = carried
    n.cashIn = cashIn
    n.basis = add(n.paid, carried)
    if (n.state === 'gone' && n.got) {
      n.result = minus(n.basis, n.got)
      n.passedOn = (out.get(n.id) ?? []).reduce((s, e) => s + (e.share ?? 0), 0)
      n.ends = scale(n.result, 1 - n.passedOn)
    }
  }
  while (ready.length) {
    const n = ready.shift() as ChainNode
    if (done.has(n.id)) continue
    settle(n)
    for (const e of out.get(n.id) ?? []) {
      indeg.set(e.to, (indeg.get(e.to) ?? 1) - 1)
      if ((indeg.get(e.to) ?? 0) <= 0) {
        ready.push(work.get(e.to)?.node as ChainNode)
        ready.sort((a, b) => nodeTime(a).localeCompare(nodeTime(b)))
      }
    }
  }
  const left = nodes.filter(n => !done.has(n.id)).sort((a, b) => nodeTime(a).localeCompare(nodeTime(b)))
  for (const n of left) { flags.push({ kind: 'loop', id: n.id }); settle(n) }
}

function makeNode(u: Unit | null, wish: ShopItem | null, ctx: MoneyCtx, opts: ChainOptions): Work {
  const item = (u?.item ?? wish) as ShopItem
  const accessories = u?.accessories ?? []
  const state: NodeState = !u ? 'wish' : item.disposal ? 'gone' : 'held'
  const paid = u ? unitCost(u, ctx) : (opts.wishPrice?.(item) ?? defaultWishPrice(item, ctx))
  const got = state === 'gone' ? unitGot(u as Unit) : null
  const node: ChainNode = {
    id: item.id, item, accessories, state, projected: false, paid, got,
    carried: ZERO, basis: paid, result: null, passedOn: 0, ends: null, cashIn: ZERO,
    bought: boughtOn(item), left: item.disposed_on ?? null,
  }
  const native = u && state === 'gone' ? unitGotNative(u) : null
  const amountCurrency = item.sale_currency ?? native?.currency ?? item.value_currency ?? 'NOK'
  return { node, native, amountCurrency, amountRate: rateFor(item, amountCurrency, ctx) }
}

/** NOK per unit for a link amount: the sale's frozen rate in its own currency, else today's. */
function rateFor(item: ShopItem, currency: string, ctx: MoneyCtx): number | null {
  if (currency === 'NOK') return 1
  if (item.sale_currency === currency && item.sale_fx_nok) return item.sale_fx_nok
  return nokPerUnit(currency, ctx.rates)
}

/** A link's real ends: an accessory counts as its unit; a fulfilled general wish as its bought model. */
function resolveEnd(id: string, units: Map<string, Unit>, byId: Map<string, ShopItem>, models: Map<string, ShopItem[]>): { unit: Unit | null; wish: ShopItem | null } | null {
  const u = units.get(id)
  if (u) return { unit: u, wish: null }
  const i = byId.get(id)
  if (!i || (i.list ?? 'wishlist') !== 'wishlist') return null
  if (i.kind === 'general' && i.status === 'fulfilled') {
    const bought = (models.get(i.id) ?? []).filter(m => units.has(m.id) && m.status === 'bought' && m.disposal !== 'returned')
      .sort((a, b) => (boughtOn(b) ?? '').localeCompare(boughtOn(a) ?? ''))
    return bought[0] ? { unit: units.get(bought[0].id) as Unit, wish: null } : null
  }
  if (i.status === 'wishlist') return { unit: null, wish: i }
  return null
}

function buildChain(ids: string[], resolved: Map<string, { unit: Unit | null; wish: ShopItem | null }>, links: { l: ShopItemLink; from: string; to: string }[], ctx: MoneyCtx, opts: ChainOptions): Chain {
  const work = new Map<string, Work>()
  for (const id of ids) {
    const r = resolved.get(id) as { unit: Unit | null; wish: ShopItem | null }
    work.set(id, makeNode(r.unit, r.wish, ctx, opts))
  }
  const set = new Set(ids)
  const edges: ChainEdge[] = links.filter(x => set.has(x.from) && set.has(x.to)).map(x => {
    const u = work.get(x.from)?.node, v = work.get(x.to)?.node
    return { id: x.l.id, from: x.from, to: x.to, amount: x.l.amount ?? null, realised: u?.state === 'gone' && v?.state !== 'wish', used: false, share: null }
  })
  // Projection: a held thing with a plan is sold at "Could sell for", the wishes it pays for are bought at their price now.
  if (opts.project) {
    for (const e of edges) {
      if (e.realised) continue
      const u = work.get(e.from)?.node as ChainNode
      const v = work.get(e.to)?.node as ChainNode
      if (u.state === 'held') {
        // Sold at "Could sell for" — the item's sets the price; an accessory without one goes with it.
        u.state = 'gone'; u.projected = true
        const rows = [u.item, ...u.accessories]
        u.got = add(...rows.map(r => (r.value_now == null ? (r === u.item ? MISSING : ZERO) : nokNow(r.value_now, r.value_currency ?? 'NOK', ctx.rates))))
        const w = work.get(e.from) as Work
        const priced = rows.filter(r => r.value_now != null)
        const currencies = new Set(priced.map(r => r.value_currency ?? 'NOK'))
        w.native = u.item.value_now != null && currencies.size === 1
          ? { amount: priced.reduce((sum, r) => sum + (r.value_now as number), 0), currency: [...currencies][0] }
          : null
      }
      if (v.state === 'wish') { v.state = 'held'; v.projected = true }
    }
  }
  for (const [id, o] of Object.entries(opts.overrides ?? {})) {
    const n = work.get(id)?.node
    if (!n) continue
    if (o.paidNok !== undefined && Number.isFinite(o.paidNok)) {
      n.paid = known(o.paidNok); n.projected = true
      if (n.state === 'wish') n.state = 'held'
    }
    if (o.gotNok !== undefined && Number.isFinite(o.gotNok)) {
      if (n.state === 'held') n.state = 'gone'
      // Another price for the sale: a link amount's share is then read in NOK.
      if (n.state === 'gone') { n.got = known(o.gotNok); n.projected = true; (work.get(id) as Work).native = null }
    }
  }
  const flags: ChainFlag[] = []
  compute(work, edges, flags)
  const nodes = [...work.values()].map(w => w.node).sort((a, b) => nodeTime(a).localeCompare(nodeTime(b)))
  const real = nodes.filter(n => n.state !== 'wish')
  const paid = add(...real.map(n => n.paid))
  const got = add(...real.map(n => n.got))
  const used = edges.filter(e => e.used)
  const linear = nodes.every(n => used.filter(e => e.from === n.id).length <= 1 && used.filter(e => e.to === n.id).length <= 1)
  return {
    id: (real[0] ?? nodes[0]).id, nodes, edges, flags, paid, got, net: minus(paid, got), linear,
    projected: nodes.some(n => n.projected),
    name: nameOf(nodes),
  }
}

/** The oldest thing's name wins when two named chains joined. */
function nameOf(nodes: readonly ChainNode[]): string | null {
  for (const n of nodes) { const t = n.item.chain_name?.trim(); if (t) return t }
  return null
}

/** "RP4 Pro → RP5 → RP6 (to buy)": the things in order. */
export function chainPath(chain: Chain): string {
  return chain.nodes.map(n => (n.state === 'wish' ? `${n.item.title} (to buy)` : n.item.title)).join(' → ')
}

/** Its name when it has one, else its path. */
export function chainTitle(chain: Chain): string {
  return chain.name ?? chainPath(chain)
}

/** The row a name is written on: the one that already carries it, else the oldest thing. */
export function chainNameHolder(chain: Chain): string {
  return chain.nodes.find(n => n.item.chain_name?.trim())?.id ?? chain.id
}

/**
 * Every chain (things joined by at least one link — a plan too), oldest
 * first. `overrides` replays the maths with other prices ("Try other prices");
 * `project` lets the plans happen. Nothing in the data changes.
 */
export function chainsOf(items: readonly ShopItem[], links: readonly ShopItemLink[], ctx: MoneyCtx, opts: ChainOptions = {}): Chain[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const units = unitsOf(items)
  const models = new Map<string, ShopItem[]>()
  for (const i of items) if (i.option_for) models.set(i.option_for, [...(models.get(i.option_for) ?? []), i])
  const resolved = new Map<string, { unit: Unit | null; wish: ShopItem | null }>()
  const valid: { l: ShopItemLink; from: string; to: string }[] = []
  const seen = new Set<string>()
  for (const l of links) {
    const a = resolveEnd(l.from_id, units, byId, models)
    const b = resolveEnd(l.to_id, units, byId, models)
    if (!a?.unit || !b) continue
    const from = a.unit.id
    const to = b.unit?.id ?? (b.wish as ShopItem).id
    if (from === to || seen.has(`${from}>${to}`)) continue
    seen.add(`${from}>${to}`)
    resolved.set(from, a)
    resolved.set(to, b)
    valid.push({ l, from, to })
  }
  if (!valid.length) return []
  const parent = new Map<string, string>()
  const find = (x: string): string => { let r = x; while (parent.get(r) !== r) r = parent.get(r) as string; parent.set(x, r); return r }
  for (const id of resolved.keys()) parent.set(id, id)
  for (const v of valid) { const a = find(v.from), b = find(v.to); if (a !== b) parent.set(a, b) }
  const groups = new Map<string, string[]>()
  for (const id of resolved.keys()) groups.set(find(id), [...(groups.get(find(id)) ?? []), id])
  const chains = [...groups.values()].map(ids => buildChain(ids, resolved, valid, ctx, opts))
  return chains.sort((a, b) => nodeTime(a.nodes[0]).localeCompare(nodeTime(b.nodes[0])))
}

/** The chain a thing belongs to (an accessory: its item's) — a chain of one when it has no links, so "Try other prices" works on anything you have or had. */
export function chainFor(itemId: string, items: readonly ShopItem[], links: readonly ShopItemLink[], ctx: MoneyCtx, opts: ChainOptions = {}): Chain | null {
  const unit = unitsOf(items).get(itemId)
  const id = unit?.id ?? itemId
  const found = chainsOf(items, links, ctx, opts).find(c => c.nodes.some(n => n.id === id))
  if (found) return found
  if (!unit) return null
  return buildChain([unit.id], new Map([[unit.id, { unit, wish: null }]]), [], ctx, opts)
}

/** The chain of every member — accessories too (cards show "Chain · 3"). */
export function chainIndex(chains: readonly Chain[]): Map<string, Chain> {
  const out = new Map<string, Chain>()
  for (const c of chains) for (const n of c.nodes) { out.set(n.id, c); for (const a of n.accessories) out.set(a.id, c) }
  return out
}

export interface FinalCost {
  /** What the thing itself cost (with its accessories). */
  own: Amount
  /** What earlier things passed on (+ a loss, − a profit). */
  carried: Amount
  /** The route cost: own + carried. */
  total: Amount
  /** Money from earlier sales that went into it. */
  cashIn: Amount
  /** A straight chain: months from the first purchase to this one (the earlier things' use). */
  earlierMonths: number | null
  /** How many earlier things passed something on. */
  earlier: number
}

/** "Route cost 4 500 NOK (3 500 + 1 000 lost on earlier ones)" — null when nothing reached it. */
export function finalCostOf(chain: Chain, itemId: string): FinalCost | null {
  const n = chain.nodes.find(x => x.id === itemId || x.accessories.some(a => a.id === itemId))
  if (!n || n.state === 'wish') return null
  const used = chain.edges.filter(e => e.used)
  if (!used.some(e => e.to === n.id)) return null
  const earlier = new Set<string>()
  const stack = [n.id]
  while (stack.length) {
    const x = stack.pop() as string
    for (const e of used) if (e.to === x && !earlier.has(e.from)) { earlier.add(e.from); stack.push(e.from) }
  }
  const first = chain.nodes.filter(x => earlier.has(x.id)).map(x => x.bought).filter((b): b is string => !!b).sort()[0]
  return {
    own: n.paid, carried: n.carried, total: n.basis, cashIn: n.cashIn, earlier: earlier.size,
    earlierMonths: chain.linear && first && n.bought && first < n.bought ? monthsBetween(first, n.bought) : null,
  }
}

export interface IfSold {
  /** What it would bring: its "Could sell for", plus its accessories' (one without a value goes along for nothing). */
  got: Amount
  /** got − what it (and those accessories) cost: + = made. */
  own: Amount
  /** In a chain: got − its route cost (earlier losses and profits included); null outside one. */
  route: Amount | null
}

/**
 * "If sold now", at "Could sell for" — the same rule a projected chain sells
 * by. Null while the thing is not yours or has no "Could sell for".
 */
export function ifSoldNow(item: ShopItem, accessories: readonly ShopItem[], ctx: MoneyCtx, final: FinalCost | null): IfSold | null {
  const value = valueNowOf(item, ctx)
  if (!value) return null
  const riding = accessories.filter(a => a.accessory_of === item.id && isMine(a))
  const got = add(value, ...riding.map(a => valueNowOf(a, ctx) ?? ZERO))
  return {
    got,
    own: minus(got, add(costOf(item, ctx), ...riding.map(a => costOf(a, ctx)))),
    route: final ? minus(got, final.total) : null,
  }
}

/** For a wish in a projected chain: its price now, the money the plans bring and the cash still needed. */
export function cashNeeded(chain: Chain, wishId: string): { price: Amount; fromSales: Amount; needed: Amount } | null {
  const n = chain.nodes.find(x => x.id === wishId)
  if (!n || !chain.edges.some(e => e.used && e.to === n.id)) return null
  return { price: n.paid, fromSales: n.cashIn, needed: minus(n.paid, n.cashIn) }
}

/** The ids a thing was paid with money from, and what its own money went to (for pickers and lists). */
export function linkedIds(itemId: string, links: readonly ShopItemLink[]): { from: string[]; to: string[] } {
  return {
    from: links.filter(l => l.to_id === itemId).map(l => l.from_id),
    to: links.filter(l => l.from_id === itemId).map(l => l.to_id),
  }
}

/** True when linking from → to would close a loop (the database refuses it too). */
export function wouldCycle(fromId: string, toId: string, links: readonly ShopItemLink[]): boolean {
  if (fromId === toId) return true
  const next = new Map<string, string[]>()
  for (const l of links) next.set(l.from_id, [...(next.get(l.from_id) ?? []), l.to_id])
  const stack = [toId]
  const seen = new Set<string>()
  while (stack.length) {
    const x = stack.pop() as string
    if (x === fromId) return true
    if (seen.has(x)) continue
    seen.add(x)
    stack.push(...(next.get(x) ?? []))
  }
  return false
}
