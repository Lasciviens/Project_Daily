// Building a money chain in one go (owner, 12.10.2026): "bought an RP5 for
// 2 000, sold it for 1 800, that money + 1 000 bought an RP6, sold it…".
// A draft is an ordered list of steps: one thing each (with simple
// accessories that go wherever it goes), what it cost, and how it left.
// Pure — scripts/verify-shop-chain-draft.cjs.
//
// The live numbers are NOT a second formula. The draft becomes the very rows
// a save writes (shop_items + shop_item_links), each with the NOK rate of its
// own day filled in the way the database's trigger fills it, and chainModel
// computes the chain from those rows — the same numbers the Owned page shows
// once the chain is saved and its rates are in.

import type { ShopCurrency, ShopDisposal, ShopFxSource, ShopItem, ShopItemLink, ShopRegion } from './types'
import { add, complete, known, minus, splitSale, type Amount, type MoneyCtx } from './ownModel'
import { chainFor, finalCostOf, ifSoldNow, type Chain, type ChainNode } from './chainModel'
import { SHOP_CURRENCIES } from './shopModel'

// ── The draft ────────────────────────────────────────────────────────────────

/** An accessory bought with the thing (same day, same currency); it goes wherever the thing goes. */
export interface DraftAccessory { key: string; title: string; price: number | null }

export interface DraftStep {
  /** The row's id once saved (a uuid), so links can be built before the save. */
  key: string
  title: string
  // Copied from the thing before while `copyPrev` is on (COPIED):
  categoryId: string | null
  platform: string
  region: ShopRegion | null
  used: boolean
  forResale: boolean
  approx: boolean
  copyPrev: boolean
  // The purchase (a new step starts in the currency of the one before; it is never copied
  // live — a price typed in NOK must not turn into lira because an earlier step changed)
  currency: ShopCurrency
  price: number | null
  boughtOn: string
  /** NOK per unit typed by hand; null = Norges Bank's rate of that day. */
  rate: number | null
  gift: boolean
  notes: string
  url: string
  accessories: DraftAccessory[]
  /** Paid with the money from the step before (the first step: from the thing the chain continues). */
  fromPrev: boolean
  /** How much of that money, in its sale's currency; null = all of it. */
  fromAmount: number | null
  // How it left
  left: boolean
  disposal: ShopDisposal
  leftOn: string
  soldTo: string
  got: number | null
  /** null = the purchase currency. */
  gotCurrency: ShopCurrency | null
  gotRate: number | null
  // Still yours: "Could sell for"
  valueNow: number | null
  valueCurrency: ShopCurrency | null
}

export interface ChainDraft {
  /** The chain's name (migration 138); a chain continued from an existing thing keeps its own. */
  name: string
  /** An existing thing that left: the first step can be paid with its money. */
  fromId: string | null
  steps: DraftStep[]
}

/** What "Copy category, subcategory and details from the previous thing" copies (live: fixing the first fixes the rest). */
export const COPIED = ['categoryId', 'platform', 'region', 'used', 'forResale', 'approx'] as const
export type Copied = Pick<DraftStep, typeof COPIED[number]>

/** How a thing can leave in the builder (a return is not part of a chain). */
export const LEAVE_WAYS: readonly ShopDisposal[] = ['sold', 'traded_in', 'given', 'broken', 'lost', 'other']
/** Ways that bring money back — the only ones with a "Got". */
export const takesMoney = (d: ShopDisposal): boolean => d === 'sold' || d === 'traded_in' || d === 'other'

export function emptyStep(key: string): DraftStep {
  return {
    key, title: '', categoryId: null, platform: '', region: null, currency: 'NOK', used: false, forResale: false, approx: false,
    copyPrev: false, price: null, boughtOn: '', rate: null, gift: false, notes: '', url: '', accessories: [],
    fromPrev: false, fromAmount: null, left: false, disposal: 'sold', leftOn: '', soldTo: '', got: null, gotCurrency: null,
    gotRate: null, valueNow: null, valueCurrency: null,
  }
}

/** A new draft: one empty step — paid with the money of `fromId` and copying it when the chain continues an existing thing (in `currency`, its sale's). */
export function newDraft(key: string, fromId: string | null = null, currency: ShopCurrency = 'NOK'): ChainDraft {
  return { name: '', fromId, steps: [{ ...emptyStep(key), currency, copyPrev: !!fromId, fromPrev: !!fromId }] }
}

/** The copied facts of an existing thing (the one a chain continues from). */
export function copiedOf(item: ShopItem): Copied {
  return {
    categoryId: item.category_id ?? null, platform: item.platform ?? '', region: item.region ?? null,
    used: !!item.used, forResale: !!item.for_resale, approx: !!item.approx_dates,
  }
}

function copiedFrom(s: Copied): Copied {
  return { categoryId: s.categoryId, platform: s.platform, region: s.region, used: s.used, forResale: s.forResale, approx: s.approx }
}

/**
 * Every step with what it copies filled in: while `copyPrev` is on, a step's
 * category, store, country, currency and flags are the thing before it's
 * (the first step's: the thing the chain continues, `base`) — live, so
 * changing the earlier one changes it too.
 */
export function resolveSteps(draft: ChainDraft, base: Copied | null): DraftStep[] {
  const out: DraftStep[] = []
  draft.steps.forEach((s, i) => {
    const before = i > 0 ? out[i - 1] : base
    out.push(s.copyPrev && before ? { ...s, ...copiedFrom(before) } : s)
  })
  return out
}

/** Turning the copy off starts the step's own facts from what it showed. */
export function setCopy(draft: ChainDraft, index: number, on: boolean, base: Copied | null): ChainDraft {
  const resolved = resolveSteps(draft, base)
  return {
    ...draft,
    steps: draft.steps.map((s, i) => (i !== index ? s : on ? { ...s, copyPrev: true } : { ...s, ...copiedFrom(resolved[i]), copyPrev: false })),
  }
}

/**
 * "+ Add next thing": a step paid with the money of the one before, copying
 * its facts and starting in the currency its money came in. The one before
 * is marked as left (sold) when it wasn't — bought → sold → bought is what a
 * chain is.
 */
export function addStep(draft: ChainDraft, key: string): ChainDraft {
  const last = draft.steps.length - 1
  const prev = draft.steps[last]
  const steps = draft.steps.map((s, i) => (i === last && !s.left ? { ...s, left: true, disposal: 'sold' as const } : s))
  const currency = prev ? prev.gotCurrency ?? prev.currency : 'NOK'
  return { ...draft, steps: [...steps, { ...emptyStep(key), currency, copyPrev: true, fromPrev: true }] }
}

export interface RemovedStep { step: DraftStep; index: number }

/** Takes a step out (never the last one left); `restoreStep` puts it back where it was. */
export function removeStep(draft: ChainDraft, index: number): { draft: ChainDraft; removed: RemovedStep | null } {
  if (draft.steps.length <= 1 || index < 0 || index >= draft.steps.length) return { draft, removed: null }
  return { draft: { ...draft, steps: draft.steps.filter((_, i) => i !== index) }, removed: { step: draft.steps[index], index } }
}

export function restoreStep(draft: ChainDraft, removed: RemovedStep): ChainDraft {
  if (draft.steps.some(s => s.key === removed.step.key)) return draft
  const steps = [...draft.steps]
  steps.splice(Math.min(removed.index, steps.length), 0, removed.step)
  return { ...draft, steps }
}

/** Anything typed — closing then asks first, and the draft is kept on this device. */
export function hasContent(draft: ChainDraft): boolean {
  return draft.name.trim() !== '' || draft.steps.length > 1 || draft.steps.some(s =>
    s.title.trim() !== '' || s.price != null || s.boughtOn !== '' || s.left || s.notes.trim() !== '' || s.url.trim() !== ''
    || s.accessories.length > 0 || s.got != null || s.valueNow != null)
}

// ── Checks ───────────────────────────────────────────────────────────────────

export type ProblemField = 'title' | 'boughtOn' | 'leftOn' | 'fromAmount' | 'rate'
/** `missing`: a field still empty (shown once Save was tried); otherwise a typed value is wrong (shown at once). */
export interface StepProblem { key: string; field: ProblemField; message: string; missing: boolean }

/** What stops a save, per step and field (a missing price is allowed: the chain then reads Unknown). */
export function draftProblems(draft: ChainDraft, today: string): StepProblem[] {
  const out: StepProblem[] = []
  for (const s of draft.steps) {
    const p = (field: ProblemField, message: string, missing = false) => out.push({ key: s.key, field, message, missing })
    if (!s.title.trim()) p('title', 'Name the thing', true)
    if (!s.boughtOn) p('boughtOn', 'When was it bought?', true)
    else if (s.boughtOn > today) p('boughtOn', 'That day has not come yet')
    if (s.left) {
      if (!s.leftOn) p('leftOn', 'When did it leave?', true)
      else if (s.leftOn > today) p('leftOn', 'That day has not come yet')
      else if (s.boughtOn && s.leftOn < s.boughtOn) p('leftOn', 'It can\'t leave before it was bought')
    }
    if (s.fromPrev && s.fromAmount != null && !(s.fromAmount > 0)) p('fromAmount', 'More than 0, or leave it for all')
    if ((s.rate != null && !(s.rate > 0)) || (s.gotRate != null && !(s.gotRate > 0))) p('rate', 'A rate is more than 0')
  }
  return out
}

// ── Rates ────────────────────────────────────────────────────────────────────

export const rateKey = (currency: string, day: string): string => `${currency}|${day}`
export interface RatePair { currency: ShopCurrency; day: string }

/** The (currency, day) pairs the draft needs Norges Bank's rate for (foreign, dated, not typed by hand). */
export function ratePairs(draft: ChainDraft, base: Copied | null): RatePair[] {
  const out = new Map<string, RatePair>()
  const want = (currency: ShopCurrency, day: string) => { if (currency !== 'NOK' && day) out.set(rateKey(currency, day), { currency, day }) }
  for (const s of resolveSteps(draft, base)) {
    if (s.rate == null && (s.price != null || s.accessories.some(a => a.price != null))) want(s.currency, s.boughtOn)
    if (s.left && takesMoney(s.disposal) && s.got != null && s.gotRate == null) want(s.gotCurrency ?? s.currency, s.leftOn)
  }
  return [...out.values()].sort((a, b) => rateKey(a.currency, a.day).localeCompare(rateKey(b.currency, b.day)))
}

// ── Rows ─────────────────────────────────────────────────────────────────────

export interface DraftRowsOptions {
  /** `live`: the rows as the database will hold them (rates from `rates`), for the numbers on screen. `save`: the rows to write — the database fills the rates. */
  mode: 'live' | 'save'
  userId: string
  /** created_at of the first row; the next ones follow a second apart, in step order. */
  nowIso: string
  /** "Could sell for" is dated today. */
  today: string
  /** A new id (save: a uuid for each link and shared sale). */
  newId: () => string
  /** Norges Bank's NOK per unit by rateKey(currency, day) — live mode. */
  rates?: ReadonlyMap<string, number> | null
}

/** Every column of a row, so a row written in one go never leaves a NOT NULL column empty (shop_restore_items reads them all). */
export type FullShopItem = Required<ShopItem>

/** A day's local noon — the same instant the other Shop forms store for a day. */
export function middayOf(day: string): string {
  return new Date(`${day.slice(0, 10)}T12:00:00`).toISOString()
}

function rateOf(currency: ShopCurrency, day: string | null, typed: number | null, o: DraftRowsOptions): { fx: number | null; source: ShopFxSource | null } {
  if (currency === 'NOK') return o.mode === 'live' ? { fx: 1, source: 'fixed' } : { fx: null, source: null }
  if (typed != null && typed > 0) return { fx: typed, source: 'manual' }
  if (o.mode === 'save' || !day) return { fx: null, source: null }
  const r = o.rates?.get(rateKey(currency, day))
  return r != null && r > 0 ? { fx: r, source: 'norges_bank' } : { fx: null, source: null }
}

/**
 * The draft as rows: per step its thing and accessories (status bought,
 * kept; the sale facts when it left — the money split by price across what
 * left together, one sale group), and a "Paid with money from" link for each
 * step paid from the one before.
 */
export function draftRows(draft: ChainDraft, base: Copied | null, o: DraftRowsOptions): { items: FullShopItem[]; links: ShopItemLink[] } {
  const steps = resolveSteps(draft, base)
  const items: FullShopItem[] = []
  const links: ShopItemLink[] = []
  const t0 = Date.parse(o.nowIso)
  let n = 0
  const createdAt = () => new Date(t0 + 1000 * n++).toISOString()
  steps.forEach((s, i) => {
    const day = s.boughtOn || null
    const accessories = s.accessories.filter(a => a.title.trim() !== '')
    const money = s.left && takesMoney(s.disposal) && s.got != null
    const gotCurrency = s.gotCurrency ?? s.currency
    const shares = money ? splitSale(s.got as number, [{ id: s.key, weight: s.price }, ...accessories.map(a => ({ id: a.key, weight: a.price }))]) : null
    const group = s.left && accessories.length ? (o.mode === 'live' ? `group:${s.key}` : o.newId()) : null
    const buyRate = rateOf(s.currency, day, s.rate, o)
    const saleRate = money ? rateOf(gotCurrency, s.leftOn || null, s.gotRate, o) : { fx: null, source: null as ShopFxSource | null }
    const row = (id: string, title: string, price: number | null, extra: Partial<FullShopItem>): FullShopItem => {
      const priced = s.gift && price == null ? 0 : price
      const at = createdAt()
      return {
        id, user_id: o.userId, category_id: s.categoryId, title: title.trim(), notes: null, price: priced,
        price_source: priced != null ? 'manual' : null, platform: s.platform.trim() || null, url: null, priority: 'medium',
        region: s.region, planned_date: null, status: 'bought', source_type: 'manual', created_at: at, updated_at: at,
        list: 'wishlist', currency: s.currency, bought_at: day ? middayOf(day) : null, task_id: null,
        kind: 'item', price_min: null, price_max: null, requirements: null, option_for: null, meets: null, accessory_of: null,
        reason: null, wait_for_deal: false, target_price: null, deal_note: null, errand: false, image_url: null, ean: null,
        fx_nok: priced != null ? buyRate.fx : null, fx_source: priced != null ? buyRate.source : null,
        market_price: null, market_currency: null, used: s.used, got_as_gift: s.gift, for_resale: s.forResale, kept: true,
        approx_dates: s.approx, serial: null, warranty_until: null, return_by: null,
        value_now: null, value_currency: null, value_on: null,
        disposed_on: s.left ? s.leftOn || null : null, disposal: s.left ? s.disposal : null,
        sale_price: money ? shares?.get(id) ?? null : null, sale_currency: money ? gotCurrency : null,
        sale_fx_nok: money ? saleRate.fx : null, sale_fx_source: money ? saleRate.source : null,
        sold_to: s.left ? s.soldTo.trim() || null : null, sale_group: group, chain_name: null,
        ...extra,
      }
    }
    const held = !s.left && s.valueNow != null
    items.push(row(s.key, s.title, s.price, {
      notes: s.notes.trim() || null, url: s.url.trim() || null,
      chain_name: i === 0 && !draft.fromId ? draft.name.trim() || null : null,
      ...(held ? { value_now: s.valueNow, value_currency: s.valueCurrency ?? s.currency, value_on: o.today } : {}),
    }))
    for (const a of accessories) items.push(row(a.key, a.title, a.price, { accessory_of: s.key }))
    const from = i === 0 ? draft.fromId : steps[i - 1].key
    if (s.fromPrev && from) {
      links.push({
        id: o.mode === 'live' ? `link:${from}>${s.key}` : o.newId(), user_id: o.userId, from_id: from, to_id: s.key,
        amount: s.fromAmount != null && s.fromAmount > 0 ? s.fromAmount : null, created_at: o.nowIso,
      })
    }
  })
  return { items, links }
}

// ── The live chain ───────────────────────────────────────────────────────────

/** The chain the draft makes, with the things already saved it continues (the Owned page's own maths). */
export function draftChain(draft: ChainDraft, rows: { items: readonly ShopItem[]; links: readonly ShopItemLink[] }, existing: { items: readonly ShopItem[]; links: readonly ShopItemLink[] }, ctx: MoneyCtx): Chain | null {
  if (!draft.steps.length) return null
  return chainFor(draft.steps[0].key, [...existing.items, ...rows.items], [...existing.links, ...rows.links], ctx)
}

/** The part above 0 (an unknown sum stays unknown). */
function above0(a: Amount): Amount {
  return complete(a) ? known(Math.max(0, a.nok)) : a
}

export interface StepView {
  node: ChainNode | null
  /** A thing that left: what it brought back minus what it cost (+ = made), before anything passed on. */
  own: Amount | null
  /** The money from earlier sales that went into it. */
  fromSales: Amount
  /** Your own money on top of that. */
  ownCash: Amount
}

export function stepView(chain: Chain | null, key: string): StepView {
  const node = chain?.nodes.find(n => n.id === key) ?? null
  if (!node) return { node: null, own: null, fromSales: known(0), ownCash: known(0) }
  return { node, own: node.got ? minus(node.got, node.paid) : null, fromSales: node.cashIn, ownCash: above0(minus(node.paid, node.cashIn)) }
}

export interface DraftOutcome {
  /** done: everything left · if-sold: a thing still yours has a "Could sell for" · holding: it has none. */
  kind: 'done' | 'if-sold' | 'holding'
  /** + made, − lost: over the whole chain (still-yours things at "Could sell for"); null while holding. */
  result: Amount | null
  /** The things that left: what they brought back minus what they cost (+ = made). */
  onLeft: Amount
  leftCount: number
  /** Your own money put in, beyond what the sales paid for (the first purchase included). */
  ownMoney: Amount
  /** The part of it added along the way: on top of the sales money that went into a later thing. */
  addedAlong: Amount
  /** Sales money that did not go into the next thing (and change from a cheaper next one). */
  inHand: Amount
  /** Still yours, with what it would bring at "Could sell for" (null without one). */
  held: { node: ChainNode; value: Amount | null }[]
  paid: Amount
  got: Amount
}

/** The answer for the summary — sums over chainModel's own nodes, no second formula. */
export function draftOutcome(chain: Chain, ctx: MoneyCtx): DraftOutcome {
  const real = chain.nodes.filter(n => n.state !== 'wish')
  const left = real.filter(n => n.state === 'gone')
  const held = real.filter(n => n.state === 'held').map(node => {
    const sold = ifSoldNow(node.item, node.accessories, ctx, finalCostOf(chain, node.id))
    return { node, value: sold?.got ?? null }
  })
  const totalCashIn = add(...real.map(n => n.cashIn))
  const onLeft = minus(add(...left.map(n => n.got)), add(...left.map(n => n.paid)))
  const fed = new Set(chain.edges.filter(e => e.used).map(e => e.to))
  const ownCash = (n: ChainNode) => above0(minus(n.paid, n.cashIn))
  const values = held.map(h => h.value)
  const kind = !held.length ? 'done' : values.every(v => v != null) ? 'if-sold' : 'holding'
  const result = kind === 'holding' ? null : minus(add(chain.got, ...values), chain.paid)
  return {
    kind, result, onLeft, leftCount: left.length,
    ownMoney: add(...real.map(ownCash)),
    addedAlong: add(...real.filter(n => fed.has(n.id)).map(ownCash)),
    inHand: add(minus(chain.got, totalCashIn), ...real.map(n => above0(minus(n.cashIn, n.paid)))),
    held, paid: chain.paid, got: chain.got,
  }
}

// ── Kept on this device ──────────────────────────────────────────────────────

const str = (v: unknown, max = 2000): string => (typeof v === 'string' ? v.slice(0, max) : '')
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const day = (v: unknown): string => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')
const bool = (v: unknown): boolean => v === true
const currency = (v: unknown): ShopCurrency | null => ((SHOP_CURRENCIES as readonly unknown[]).includes(v) ? v as ShopCurrency : null)
const id = (v: unknown): string | null => (typeof v === 'string' && /^[\w:-]{1,64}$/.test(v) ? v : null)

/** A kept draft read back field by field: anything odd falls back to its default, a broken one to null. */
export function parseDraft(raw: unknown): ChainDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.steps) || !r.steps.length || r.steps.length > 50) return null
  const steps: DraftStep[] = []
  for (const x of r.steps) {
    if (!x || typeof x !== 'object') return null
    const s = x as Record<string, unknown>
    const key = id(s.key)
    if (!key || steps.some(p => p.key === key)) return null
    const base = emptyStep(key)
    steps.push({
      ...base, title: str(s.title, 200), categoryId: id(s.categoryId), platform: str(s.platform, 200),
      region: s.region === 'NO' || s.region === 'TR' ? s.region : null, currency: currency(s.currency) ?? 'NOK',
      used: bool(s.used), forResale: bool(s.forResale), approx: bool(s.approx), copyPrev: bool(s.copyPrev),
      price: num(s.price), boughtOn: day(s.boughtOn), rate: num(s.rate), gift: bool(s.gift), notes: str(s.notes), url: str(s.url, 2000),
      accessories: (Array.isArray(s.accessories) ? s.accessories : []).slice(0, 30).flatMap(a => {
        const k = id((a as Record<string, unknown>)?.key)
        return k ? [{ key: k, title: str((a as Record<string, unknown>).title, 200), price: num((a as Record<string, unknown>).price) }] : []
      }),
      fromPrev: bool(s.fromPrev), fromAmount: num(s.fromAmount), left: bool(s.left),
      disposal: (LEAVE_WAYS as readonly unknown[]).includes(s.disposal) ? s.disposal as ShopDisposal : 'sold',
      leftOn: day(s.leftOn), soldTo: str(s.soldTo, 200), got: num(s.got), gotCurrency: currency(s.gotCurrency), gotRate: num(s.gotRate),
      valueNow: num(s.valueNow), valueCurrency: currency(s.valueCurrency),
    })
  }
  return { name: str(r.name, 80), fromId: id(r.fromId), steps }
}
