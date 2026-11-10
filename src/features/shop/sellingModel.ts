// The selling screens (Shop step C, approved 10.11.2026): a thing's open listing and its tag on Owned's rows, the
// old estimates the "Update values" sheet lists, the price cuts a nudge offers, the ad's facts, a small history of
// estimates, a checklist's steps as rows, and which steps were ticked. Pure — scripts/verify-shop-selling.cjs.
//
// Nothing here invents a price: a price cut is a share of the owner's own asking price, an ad's price is the
// listing's or the owner's own "Could sell for", and a history of estimates holds only what the owner typed.

import type { Tone } from '../../shared/ui/Tone'
import { boughtOn, daysBetween, isMine, valueAgeDays, VALUE_STALE_DAYS } from './ownModel'
import { isHost, MAX_CHECKLIST_STEPS } from './resaleRows'
import type { AdFacts } from './resaleTexts'
import type { ResaleCondition, ShopAdTemplate, ShopListing, ShopValuePoint } from './resaleTypes'
import type { ShopDisposal, ShopItem } from './types'

/** A listing still open: the ad written (Listed) or up (For sale). One per thing (192). */
export const isOpen = (l: Pick<ShopListing, 'status'>): boolean => l.status === 'listed' || l.status === 'for_sale'

/** The thing's open listing, or null. */
export function openListingOf(listings: readonly ShopListing[], itemId: string): ShopListing | null {
  return listings.filter(l => l.item_id === itemId && isOpen(l)).sort((a, b) => b.listed_on.localeCompare(a.listed_on) || b.created_at.localeCompare(a.created_at))[0] ?? null
}

/** The thing's listings that ended (sold or taken down), newest first. */
export function endedListingsOf(listings: readonly ShopListing[], itemId: string): ShopListing[] {
  return listings.filter(l => l.item_id === itemId && !isOpen(l))
    .sort((a, b) => (b.ended_on ?? b.listed_on).localeCompare(a.ended_on ?? a.listed_on) || b.created_at.localeCompare(a.created_at))
}

/** Each thing's open listing, by its id. */
export function openListingsByItem(listings: readonly ShopListing[]): Map<string, ShopListing> {
  const out = new Map<string, ShopListing>()
  for (const l of listings) {
    if (!isOpen(l)) continue
    const had = out.get(l.item_id)
    if (!had || l.listed_on > had.listed_on) out.set(l.item_id, l)
  }
  return out
}

/** Days it has been up for sale (from the ad going up); null unless for sale. */
export function daysForSale(l: Pick<ShopListing, 'status' | 'for_sale_on'>, today: string): number | null {
  return l.status === 'for_sale' && l.for_sale_on ? Math.max(0, daysBetween(l.for_sale_on, today)) : null
}

const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/**
 * A row's tag for its open listing: "For sale · 12 days" (info — a thing in progress), or "Listed" while the ad is
 * written but not up (neutral). Null without an open listing: the tag comes from the listing's facts only.
 */
export function listingTag(l: ShopListing | null | undefined, today: string): { text: string; tone: Tone } | null {
  if (!l || !isOpen(l)) return null
  const days = daysForSale(l, today)
  if (days !== null) return { text: `For sale · ${days === 0 ? 'today' : dayWord(days)}`, tone: 'info' }
  return l.status === 'listed' ? { text: 'Listed', tone: 'neutral' } : null
}

/** "For sale on finn.no · 12 days" / "Listed on finn.no" / "Sold on finn.no after 9 days" / "Taken down after 20 days". */
export function listingWords(l: ShopListing, today: string): string {
  const on = l.marketplace ? ` on ${l.marketplace}` : ''
  if (l.status === 'listed') return `Listed${on}`
  if (l.status === 'for_sale') {
    const d = daysForSale(l, today) ?? 0
    return `For sale${on} · ${d === 0 ? 'since today' : dayWord(d)}`
  }
  const from = l.for_sale_on ?? l.listed_on
  const days = l.ended_on ? Math.max(0, daysBetween(from, l.ended_on)) : null
  const after = days === null ? '' : days === 0 ? ' the same day' : ` after ${dayWord(days)}`
  return l.status === 'sold' ? `Sold${on}${after}` : `Taken down${on}${after}`
}

/**
 * What a nudge offers to lower it to: 5 % and 10 % off the price now, each rounded down to a round number (10s
 * below 1 000, 50s below 10 000, else 100s), each above 0 and below the price, no two the same. A share of the
 * owner's own price — never a price from outside.
 */
export function priceCuts(price: number): number[] {
  if (!Number.isFinite(price) || price <= 0) return []
  const step = price < 1000 ? 10 : price < 10000 ? 50 : 100
  const out: number[] = []
  for (const share of [0.05, 0.1]) {
    const n = Math.floor((price * (1 - share)) / step) * step
    if (n > 0 && n < price && !out.includes(n)) out.push(n)
  }
  return out
}

// ── Update values ────────────────────────────────────────────────────────────

/** A "Could sell for" is old after this many days (ownModel's). */
export const OLD_ESTIMATE_DAYS = VALUE_STALE_DAYS

/** Whether a thing still yours has an estimate older than six months. */
export function hasOldEstimate(i: ShopItem, today: string): boolean {
  if (!isMine(i) || i.value_now == null || !Number.isFinite(i.value_now)) return false
  const age = valueAgeDays(i, today)
  return age !== null && age > OLD_ESTIMATE_DAYS
}

/** Every thing still yours with an old estimate, the oldest first (then by name). */
export function oldEstimates(items: readonly ShopItem[], today: string): ShopItem[] {
  return items.filter(i => hasOldEstimate(i, today))
    .sort((a, b) => (a.value_on as string).localeCompare(b.value_on as string) || a.title.localeCompare(b.title))
}

/** One row of the Update values sheet as saved: the new estimate on its day. */
export interface ValueUpdate { id: string; value_now: number; value_currency: string; value_on: string }

/** The patch that puts an estimate back as it was (an Update values Undo). */
export function valueBefore(i: Pick<ShopItem, 'id' | 'value_now' | 'value_currency' | 'value_on'>) {
  return { id: i.id, value_now: i.value_now, value_currency: i.value_currency, value_on: i.value_on }
}

/** "3 estimates updated" / "1 estimate updated". */
export function valuesSavedWords(n: number): string {
  return `${n} estimate${n === 1 ? '' : 's'} updated`
}

/**
 * The thing's estimates, newest first: every one the value history kept (192), and the thing's own "Could sell for"
 * when its day is not among them (an estimate from before the history began). Only for this thing.
 */
export function estimateHistory(values: readonly ShopValuePoint[], item: Pick<ShopItem, 'id' | 'value_now' | 'value_currency' | 'value_on'>):
  { on: string; value: number; currency: string }[] {
  const out = values.filter(v => v.item_id === item.id).map(v => ({ on: v.valued_on, value: v.value, currency: v.currency }))
  if (item.value_now != null && Number.isFinite(item.value_now) && item.value_on && !out.some(v => v.on === item.value_on)) {
    out.push({ on: item.value_on, value: item.value_now, currency: item.value_currency ?? 'NOK' })
  }
  return out.sort((a, b) => b.on.localeCompare(a.on))
}

// ── The ad ───────────────────────────────────────────────────────────────────

/** The marketplaces the templates name (hosts, as data), in the order they were made; never a name in code. */
export function marketplacesOf(templates: readonly ShopAdTemplate[]): string[] {
  const out: string[] = []
  for (const t of [...templates].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (t.marketplace && isHost(t.marketplace) && !out.includes(t.marketplace)) out.push(t.marketplace)
  }
  return out
}

/** The marketplace's own front page, built from its host only (a link out; never fetched): https://finn.no. */
export function marketplaceLink(host: string | null | undefined): string | null {
  return host && isHost(host) ? `https://${host}` : null
}

/**
 * What the ad says, from the thing and the owner's choices in the ad sheet: its name, the condition picked, the
 * day it was bought ("ca." when from memory), the asking price — the open listing's price now, else the owner's
 * own "Could sell for" — and the accessories ticked. Never its serial number, the store, what it cost or a buyer.
 */
export function adFactsOf(item: ShopItem, choice: { condition: ResaleCondition | null; price: number | null; currency: string; accessories: readonly string[]; bought: boolean }): AdFacts {
  return {
    name: item.title,
    condition: choice.condition,
    bought: choice.bought ? boughtOn(item) : null,
    approx: !!item.approx_dates,
    price: choice.price,
    currency: choice.currency,
    accessories: choice.accessories,
  }
}

/** The asking price an ad starts with: the open listing's price now, else the owner's own estimate, else none. */
export function adPriceOf(item: Pick<ShopItem, 'value_now' | 'value_currency'>, listing: Pick<ShopListing, 'prices' | 'currency'> | null):
  { price: number | null; currency: string; from: 'listing' | 'estimate' | null } {
  if (listing && listing.prices.length) return { price: listing.prices[listing.prices.length - 1].price, currency: listing.currency, from: 'listing' }
  if (item.value_now != null && Number.isFinite(item.value_now)) return { price: item.value_now, currency: item.value_currency ?? 'NOK', from: 'estimate' }
  return { price: null, currency: 'NOK', from: null }
}

/** The ad as one text to paste: its title, a blank line, its body. */
export function adClipboardText(title: string, body: string): string {
  return [title.trim(), body.trim()].filter(Boolean).join('\n\n')
}

// ── The hand-over checklist ──────────────────────────────────────────────────

/** Ways of leaving where the thing is handed to someone, so the hand-over checklist applies. */
export const HANDED_OVER: readonly ShopDisposal[] = ['sold', 'traded_in', 'given', 'other']

/** A checklist's rows as edited, back to its text: each trimmed, blank ones left out, one per line. */
export function stepsText(rows: readonly string[]): string {
  return rows.map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

/** Why edited rows can't be saved (null: they can): at least one step, at most 60, the whole at most 4 000 characters. */
export function stepsProblem(rows: readonly string[]): string | null {
  const text = stepsText(rows)
  const n = text ? text.split('\n').length : 0
  if (n === 0) return 'A checklist needs at least one step'
  if (n > MAX_CHECKLIST_STEPS) return `A checklist has at most ${MAX_CHECKLIST_STEPS} steps`
  if (text.length > 4000) return 'A checklist is at most 4 000 characters'
  return null
}

/** Which steps of a thing's hand-over were ticked, by the step's words (an edited step starts unticked). */
export type TickBook = Record<string, { on: string; ticked: string[] }>
/** At most this many things' ticks are kept on the device (the oldest go first). */
export const TICK_BOOK_MAX = 20

/** The steps ticked for a thing, among the steps it has now. */
export function ticksOf(book: TickBook, itemId: string, steps: readonly string[]): Set<string> {
  const had = book[itemId]?.ticked ?? []
  return new Set(had.filter(s => steps.includes(s)))
}

/** The book with a thing's ticks set (none: its entry goes), the newest first, at most TICK_BOOK_MAX things. */
export function withTicks(book: TickBook, itemId: string, ticked: readonly string[], today: string): TickBook {
  const rest = Object.entries(book).filter(([id, e]) => id !== itemId && e && Array.isArray(e.ticked) && typeof e.on === 'string')
  const entries: [string, { on: string; ticked: string[] }][] = ticked.length ? [[itemId, { on: today, ticked: [...new Set(ticked)] }], ...rest] : rest
  entries.sort((a, b) => (a[0] === itemId ? -1 : b[0] === itemId ? 1 : b[1].on.localeCompare(a[1].on)))
  return Object.fromEntries(entries.slice(0, TICK_BOOK_MAX))
}

/** A stored book read back: only entries of the right shape. */
export function parseTickBook(raw: unknown): TickBook {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: TickBook = {}
  for (const [id, e] of Object.entries(raw as Record<string, unknown>)) {
    const v = e as { on?: unknown; ticked?: unknown } | null
    if (!v || typeof v.on !== 'string' || !Array.isArray(v.ticked)) continue
    out[id] = { on: v.on, ticked: v.ticked.filter((s): s is string => typeof s === 'string') }
  }
  return out
}
