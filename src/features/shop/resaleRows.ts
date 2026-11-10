// Resale's rows (migration 192), checked where they enter: what the owner types before it is sent, and every row
// the database answers. The lists and patterns mirror 192's checks (scripts/verify-shop-resale.cjs compares them).
// Pure.

import { isDay } from './dealDays'
import { SHOP_CURRENCIES } from './shopModel'
import { isUuid } from './signalStates'
import type {
  AdLanguage, ListingPrice, ListingStatus, ResaleCondition, ShopAdNote, ShopAdTemplate, ShopHandoverChecklist,
  ShopListing, ShopTradeInQuote, ShopValuePoint,
} from './resaleTypes'
import type { ShopCurrency } from './types'

export const RESALE_CONDITIONS: readonly ResaleCondition[] = ['new', 'like_new', 'good', 'fair', 'for_parts']
export const LISTING_STATUSES: readonly ListingStatus[] = ['listed', 'for_sale', 'sold', 'withdrawn']
export const AD_LANGUAGES: readonly AdLanguage[] = ['nb', 'en']
/** A listing's price story holds its asking price and at most 99 changes. */
export const MAX_LISTING_PRICES = 100
/** A listing's price is below a billion (192). */
export const MAX_LISTING_PRICE = 1_000_000_000
export const MAX_CHECKLIST_STEPS = 60

/**
 * An ad's link: one https address — a host of letters, digits, dots and hyphens (so no user:password@), an optional
 * port, then a path, query or fragment without spaces or control characters; at most 2 048 characters. 192's CHECK
 * is the same pattern (a phone's Unicode space is refused here too).
 */
// eslint-disable-next-line no-control-regex -- the pattern exists to refuse control characters
export const AD_URL_RE = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:[0-9]{1,5})?([/?#][^\s\x00-\x1f\x7f]*)?$/
export const AD_URL_MAX = 2048
/** A marketplace's host, as shop_site_policies keeps one (finn.no). */
export const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

export const isAdUrl = (s: unknown): s is string => typeof s === 'string' && s.length <= AD_URL_MAX && AD_URL_RE.test(s)
export const isHost = (s: unknown): s is string => typeof s === 'string' && s.length <= 253 && HOST_RE.test(s)
export const isCondition = (s: unknown): s is ResaleCondition => RESALE_CONDITIONS.includes(s as ResaleCondition)
export const isCurrency = (s: unknown): s is ShopCurrency => SHOP_CURRENCIES.includes(s as ShopCurrency)

/** The link's host, lower case (null when it is no ad link). */
export function hostOf(url: string): string | null {
  if (!isAdUrl(url)) return null
  return url.slice('https://'.length).split(/[/?#:]/, 1)[0].toLowerCase()
}

/** Whether a link is on a host or one of its subdomains (www.finn.no is on finn.no; evilfinn.no is not) — 192's rule. */
export function linkOnHost(url: string, host: string): boolean {
  const h = hostOf(url)
  return h !== null && (h === host || h.endsWith(`.${host}`))
}

/**
 * The marketplace a pasted link is on: one of the known ones (the hosts the app knows as data — the templates'
 * marketplaces, shop_site_policies) that it is on, the most specific first; else its own host without "www." or
 * "m.". Null for no ad link. Never a name in code.
 */
export function marketplaceOf(url: string, known: readonly string[] = []): string | null {
  const h = hostOf(url)
  if (h === null) return null
  const hit = [...known].filter(isHost).sort((a, b) => b.length - a.length).find(k => h === k || h.endsWith(`.${k}`))
  if (hit) return hit
  const bare = h.replace(/^(www|m)\./, '')
  return isHost(bare) ? bare : null
}

/** A price from 0 below `max` (no NaN, no infinity). */
export const isPrice = (n: unknown, max = Infinity): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < max

/**
 * Whether a price story is one 192 takes: 1–100 steps of {on, price}, in order from the listing's day to `lastDay`
 * (tomorrow in Oslo), each price from 0 below a billion. Null when it is; else what is wrong, in plain words.
 */
export function pricesProblem(prices: readonly ListingPrice[], listedOn: string, lastDay: string): string | null {
  if (!Array.isArray(prices) || prices.length < 1) return 'A listing needs its asking price'
  if (prices.length > MAX_LISTING_PRICES) return `A listing keeps at most ${MAX_LISTING_PRICES - 1} price changes`
  let prev = listedOn
  for (const p of prices) {
    if (!p || !isDay(p.on) || !isPrice(p.price, MAX_LISTING_PRICE)) return 'A price change is a day and an amount from 0 up'
    if (p.on < prev || p.on > lastDay) return 'Price changes go in order, from the day it was listed up to today'
    prev = p.on
  }
  return null
}

// ── Rows from the database ───────────────────────────────────────────────────

type R = Record<string, unknown>
const obj = (row: unknown): R | null => (row && typeof row === 'object' ? (row as R) : null)
const text = (x: unknown): string | null => (typeof x === 'string' ? x : null)
/** numeric comes back as a number or a string. */
function num(x: unknown): number | null {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}
const time = (x: unknown): string | null => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null)
const day = (x: unknown): string | null => (isDay(x) ? x : null)
const ids = (r: R): boolean => isUuid(r.id) && isUuid(r.user_id)
const stamps = (r: R): { created_at: string; updated_at: string } | null => {
  const created_at = time(r.created_at), updated_at = time(r.updated_at)
  return created_at && updated_at ? { created_at, updated_at } : null
}

export function parseAdNote(row: unknown): ShopAdNote | null {
  const r = obj(row)
  if (!r || !ids(r) || !isUuid(r.item_id) || !isAdUrl(r.ad_url) || !isCurrency(r.currency)) return null
  const price = num(r.price), noted = day(r.noted_on), st = stamps(r)
  const marketplace = r.marketplace == null ? null : isHost(r.marketplace) ? r.marketplace : undefined
  const condition = r.condition == null ? null : isCondition(r.condition) ? r.condition : undefined
  if (price === null || price < 0 || !noted || !st || marketplace === undefined || condition === undefined || typeof r.asking !== 'boolean') return null
  return { id: r.id as string, user_id: r.user_id as string, item_id: r.item_id, ad_url: r.ad_url, marketplace, price, currency: r.currency,
    condition, asking: r.asking, noted_on: noted, ...st }
}

export function parseTradeInQuote(row: unknown): ShopTradeInQuote | null {
  const r = obj(row)
  if (!r || !ids(r) || !isUuid(r.item_id) || !isCurrency(r.currency)) return null
  const dealer = text(r.dealer)?.trim() ?? '', amount = num(r.amount), quoted = day(r.quoted_on), st = stamps(r)
  const condition = r.condition == null ? null : isCondition(r.condition) ? r.condition : undefined
  const note = r.note == null ? null : text(r.note) ?? undefined
  if (!dealer || amount === null || amount < 0 || !quoted || !st || condition === undefined || note === undefined) return null
  return { id: r.id as string, user_id: r.user_id as string, item_id: r.item_id, dealer, amount, currency: r.currency, condition, quoted_on: quoted,
    note, ...st }
}

export function parseValuePoint(row: unknown): ShopValuePoint | null {
  const r = obj(row)
  if (!r || !ids(r) || !isUuid(r.item_id) || !isCurrency(r.currency)) return null
  const value = num(r.value), valued = day(r.valued_on), st = stamps(r)
  if (value === null || value < 0 || !valued || !st) return null
  return { id: r.id as string, user_id: r.user_id as string, item_id: r.item_id, valued_on: valued, value, currency: r.currency, ...st }
}

/** A price story as stored; null when any step is not {on: day, price: amount}. */
export function parseListingPrices(x: unknown): ListingPrice[] | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_LISTING_PRICES) return null
  const out: ListingPrice[] = []
  for (const e of x) {
    const p = obj(e)
    const on = p ? day(p.on) : null
    const price = p ? num(p.price) : null
    if (!on || price === null || price < 0) return null
    out.push({ on, price })
  }
  return out
}

export function parseListing(row: unknown): ShopListing | null {
  const r = obj(row)
  if (!r || !ids(r) || !isUuid(r.item_id) || !isCurrency(r.currency) || !LISTING_STATUSES.includes(r.status as ListingStatus)) return null
  const listed = day(r.listed_on), st = stamps(r), prices = parseListingPrices(r.prices)
  const forSale = r.for_sale_on == null ? null : day(r.for_sale_on) ?? undefined
  const ended = r.ended_on == null ? null : day(r.ended_on) ?? undefined
  const marketplace = r.marketplace == null ? null : isHost(r.marketplace) ? r.marketplace : undefined
  const adUrl = r.ad_url == null ? null : isAdUrl(r.ad_url) ? r.ad_url : undefined
  const adText = r.ad_text == null ? null : text(r.ad_text) ?? undefined
  if (!listed || !st || !prices || forSale === undefined || ended === undefined || marketplace === undefined || adUrl === undefined
      || adText === undefined || typeof r.closed_by_sale !== 'boolean') return null
  return {
    id: r.id as string, user_id: r.user_id as string, item_id: r.item_id, marketplace, ad_url: adUrl, status: r.status as ListingStatus,
    listed_on: listed, for_sale_on: forSale, ended_on: ended, currency: r.currency, prices, ad_text: adText, closed_by_sale: r.closed_by_sale, ...st,
  }
}

export function parseAdTemplate(row: unknown): ShopAdTemplate | null {
  const r = obj(row)
  if (!r || !ids(r) || !AD_LANGUAGES.includes(r.language as AdLanguage)) return null
  const title = text(r.title), body = text(r.body), st = stamps(r)
  const marketplace = r.marketplace == null ? null : isHost(r.marketplace) ? r.marketplace : undefined
  const category = r.category == null ? null : text(r.category) ?? undefined
  if (!title?.trim() || !body?.trim() || !st || marketplace === undefined || category === undefined) return null
  return { id: r.id as string, user_id: r.user_id as string, marketplace, category, language: r.language as AdLanguage, title, body, ...st }
}

export function parseChecklist(row: unknown): ShopHandoverChecklist | null {
  const r = obj(row)
  if (!r || !ids(r)) return null
  const category = text(r.category), steps = text(r.steps), st = stamps(r)
  if (!category?.trim() || !steps?.trim() || !st) return null
  return { id: r.id as string, user_id: r.user_id as string, category, steps, ...st }
}

/** A checklist's steps, one per line, blank lines left out. */
export function checklistSteps(steps: string): string[] {
  return steps.split('\n').map(s => s.trim()).filter(Boolean)
}
