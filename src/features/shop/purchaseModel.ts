// One thing's purchase against its store's rules and Norway's law (migration 191's rows; no store is special):
// which store it was bought at, its deadlines (Just bought and the record — each date explains itself), the price
// protection that still holds, the offers Prisjakt listed for it, a store that matches a cheaper one, money got
// back, and the marketplace searches built from its name. Pure — scripts/verify-shop-purchase.cjs.
import { addDays, isDay } from './dealDays'
import { localDay } from './shopModel'
import { addMonths } from './ownModel'
import {
  offersOfWatch, priceMatches, purchaseDeadlines, ruleName, rulesInForce, searchLinkFor, sourceWords, storeOfLink, storeOfShopName,
  type PriceMatch, type PriceOffer, type PurchaseDeadlines, type PurchaseFacts,
} from './storeRules'
import { isShownLink } from './storeRows'
import type { ShopCurrency, ShopItem, ShopItemCost, ShopLawRule, ShopPriceWatch, ShopStore, ShopStoreRule } from './types'

/** The rows a purchase is counted against. */
export interface StoreCtx { stores: readonly ShopStore[]; rules: readonly ShopStoreRule[]; law: readonly ShopLawRule[] }

type PurchaseFields = Pick<ShopItem, 'url' | 'platform' | 'bought_at' | 'used' | 'warranty_until'>
  & Partial<Pick<ShopItem, 'bought_channel' | 'arrived_on'>>

/**
 * The store it was bought at: its link's host (storeRules.storeOfLink), else its store's name; null = no row. A price
 * site is never where a thing was bought (a wish's Prisjakt link): its store's name decides, else none.
 */
export function storeOfItem(item: Pick<ShopItem, 'url' | 'platform'>, stores: readonly ShopStore[]): ShopStore | null {
  const seller = (s: ShopStore | null) => (s && s.kind !== 'price_site' ? s : null)
  return seller(item.url ? storeOfLink(item.url, stores) : null) ?? seller(item.platform ? storeOfShopName(item.platform, stores) : null)
}

/** yyyy-mm-dd of the purchase (Oslo), or null. */
export const boughtDayOf = (item: Pick<ShopItem, 'bought_at'>): string | null => (item.bought_at ? localDay(item.bought_at) : null)

/** The day counts start on: arrival once tapped (never before the purchase), else the purchase day. */
export function startDayOf(item: Pick<ShopItem, 'bought_at'> & Partial<Pick<ShopItem, 'arrived_on'>>): string | null {
  const bought = boughtDayOf(item)
  if (!bought) return null
  return item.arrived_on && isDay(item.arrived_on) && item.arrived_on >= bought ? item.arrived_on : bought
}

/**
 * The complaint years a stored "Can complain until" stands for (2 or 5 from the purchase day or arrival), or null
 * when it is another date (a warranty typed by hand): the 5-year right is for a thing meant to last much longer.
 */
export function complaintYearsOf(item: PurchaseFields): 2 | 5 | null {
  const bought = boughtDayOf(item)
  if (!bought || !item.warranty_until) return null
  const starts = [bought, startDayOf(item) ?? bought]
  for (const y of [2, 5] as const) if (starts.some(s => addMonths(s, y * 12) === item.warranty_until)) return y
  return null
}

/** What is known about a purchase, for storeRules.purchaseDeadlines. `years` overrides the stored complaint years. */
export function factsOf(item: PurchaseFields, store: ShopStore | null, years?: 2 | 5 | null): PurchaseFacts | null {
  const boughtOn = boughtDayOf(item)
  if (!boughtOn) return null
  const y = years === undefined ? complaintYearsOf(item) : years
  return {
    boughtOn,
    arrivedOn: item.arrived_on ?? null,
    channel: item.bought_channel ?? null,
    // A marketplace's sellers are private people (FINN: no right to cancel); a shop is a business; no row = not known.
    seller: store ? (store.kind === 'marketplace' ? 'private' : 'business') : null,
    longLasting: y === 5 ? true : y === 2 ? false : null,
    // "Bought used" is ticked or not; whether it was a campaign price is never known from the row.
    conditions: { used: item.used === true },
  }
}

/** Return by and complain by for a purchase, with the store it was counted against. */
export function deadlinesOf(item: PurchaseFields, ctx: StoreCtx, years?: 2 | 5 | null): { store: ShopStore | null; deadlines: PurchaseDeadlines | null } {
  const store = storeOfItem(item, ctx.stores)
  const facts = factsOf(item, store, years)
  return { store, deadlines: facts ? purchaseDeadlines(facts, { store, rules: ctx.rules, law: ctx.law }) : null }
}

/** Whether a stored date is what the rules give ('rules'), the owner's own ('own'), or not set ('none'). */
export function dateSource(stored: string | null | undefined, computed: string | null | undefined): 'rules' | 'own' | 'none' {
  if (!stored) return 'none'
  return computed && stored === computed ? 'rules' : 'own'
}

// ── Price protection ─────────────────────────────────────────────────────────

export interface Protection {
  /** yyyy-mm-dd: the last day it holds (counted from the purchase day). */
  until:   string
  rule:    ShopStoreRule
  /** "Elkjøp's 30-day price protection". */
  name:    string
  /** "Elkjøp's 30-day price protection, read 10.11.2026" — and what it may not cover. */
  words:   string
  /** The store's own price only, or any shop's. */
  against: 'own' | 'any'
}

/**
 * The price protection that still holds for a purchase at `store` on `today`: the rule in force for the owner's
 * tier with the latest last day, counted from the purchase day (a store's promise runs from the sale, not the
 * delivery). Exclusions it can't check are named in the words, never assumed away.
 */
export function protectionOf(item: PurchaseFields, store: ShopStore | null, rules: readonly ShopStoreRule[], today: string): Protection | null {
  const bought = boughtDayOf(item)
  if (!store || !bought) return null
  let best: Protection | null = null
  for (const rule of rulesInForce(store, rules)) {
    if (rule.kind !== 'price_protection' || rule.days === null || (rule.against !== 'own' && rule.against !== 'any')) continue
    if (rule.exclusions.includes('used') && item.used) continue
    const until = addDays(bought, rule.days)
    if (until < today || (best && best.until >= until)) continue
    const open = rule.exclusions.filter(e => e !== 'used')
    const unless = open.length ? ` — if it wasn't ${open.map(e => EXCLUDED[e]).join(' or ')}` : ''
    best = { until, rule, name: ruleName(rule, store), words: `${ruleName(rule, store)}, ${sourceWords(rule)}${unless}`, against: rule.against }
  }
  return best
}

const EXCLUDED: Record<ShopStoreRule['exclusions'][number], string> = {
  campaign: 'a campaign price', black_friday: 'a Black Friday price', outlet: 'from the outlet', marketplace_seller: 'from a marketplace seller', used: 'used',
}

/** The price a protection compares against now: the store's own (its page, or its offer on Prisjakt's list) or any shop's. */
export function protectedPrice(
  p: Protection, store: ShopStore, watch: ShopPriceWatch | null | undefined, offers: readonly PriceOffer[], stores: readonly ShopStore[],
): { amount: number; currency: string; where: string } | null {
  const fromPage = watch && watch.status === 'ok' && watch.source === 'store' && watch.low != null && watch.currency
    && watch.url && storeOfLink(watch.url, stores)?.id === store.id
    ? { amount: watch.low, currency: watch.currency, where: store.name } : null
  const mine = offers.filter(o => o.storeId === store.id && o.currency === store.currency)
  const listed = (p.against === 'own' ? mine : offers.filter(o => o.currency === store.currency))
    .reduce<PriceOffer | null>((m, o) => (!m || o.price < m.price ? o : m), null)
  const fromList = listed ? { amount: listed.price, currency: listed.currency, where: listed.shop } : null
  if (!fromPage) return fromList
  return fromList && fromList.amount < fromPage.amount ? fromList : fromPage
}

// ── Money got back ───────────────────────────────────────────────────────────

/** Money already got back on a thing in its own currency (rebates are costs below 0) — a claim is counted past it. */
export function gotBackOf(costs: readonly ShopItemCost[], currency: ShopCurrency): number {
  return costs.filter(c => c.amount < 0 && c.currency === currency).reduce((s, c) => s - c.amount, 0)
}

/** A rebate's label: "Price protection · Elkjøp", "Price match · Power", "Money back". */
export function rebateLabel(kind: 'protection' | 'match' | 'other', from: string | null): string {
  const what = kind === 'protection' ? 'Price protection' : kind === 'match' ? 'Price match' : 'Money back'
  const store = from?.trim().slice(0, 60)
  return store ? `${what} · ${store}` : what
}

// ── Prisjakt's offers ────────────────────────────────────────────────────────

/**
 * The new offers of a watch's last read, for price match and price protection: only from an `ok` Prisjakt read
 * (its new_offers, checked where they entered — storeRows.parseNewOffers at the read, 191's CHECK in the
 * database), each shop found among the stores by its name (storeRules.offersOfWatch). Empty before 191.
 */
export function watchOffers(watch: ShopPriceWatch | null | undefined, stores: readonly ShopStore[]): PriceOffer[] {
  if (!watch || watch.source !== 'prisjakt' || watch.status !== 'ok' || !Array.isArray(watch.new_offers)) return []
  return offersOfWatch(watch.new_offers, stores)
}

/** The best price match for a wish from its Prisjakt read, or null (storeRules.priceMatches, best saving first). */
export function bestMatchOf(watch: ShopPriceWatch | null | undefined, ctx: StoreCtx, now: string): PriceMatch | null {
  const offers = watchOffers(watch, ctx.stores)
  if (!watch || !offers.length) return null
  return priceMatches(ctx.stores, ctx.rules, offers, watch.last_ok_at ?? watch.checked_at, now)[0] ?? null
}

// ── Marketplace searches ─────────────────────────────────────────────────────

/** The words a search is built from: the thing's name (brand + model, as the owner wrote it), without brackets. */
export function searchWordsOf(item: Pick<ShopItem, 'title'>): string {
  return item.title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

export interface MarketSearch {
  store: ShopStore
  /** The search link (https, on the store's own host — searchLinkFor checks it), or null: the store has no pattern yet. */
  url:   string | null
}

/** "Look on FINN / Tise": every marketplace the owner hasn't hidden, with its search link for this thing. */
export function marketSearches(item: Pick<ShopItem, 'title'>, stores: readonly ShopStore[]): MarketSearch[] {
  const words = searchWordsOf(item)
  return stores.filter(s => s.kind === 'marketplace' && !s.hidden)
    .map(store => {
      const url = words ? searchLinkFor(store, words) : null
      return { store, url: url && isShownLink(url) ? url : null }
    })
    .sort((a, b) => a.store.name.localeCompare(b.store.name, 'en'))
}

/** A link's address as it is shown before it opens: its host and path, the query decoded ("finn.no/…?q=Sony WH-1000XM5"). */
export function shownAddress(url: string): string {
  if (!isShownLink(url)) return ''
  const rest = url.slice('https://'.length).replace(/^www\./, '')
  try { return decodeURIComponent(rest) } catch { return rest }
}
