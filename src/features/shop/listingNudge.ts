// A listing that has been for sale a while: "12 days, no sale; yours usually go in 9 — lower it?" (Shop step C).
// Pure — scripts/verify-shop-resale.cjs.
//
// "Yours usually go in" is the middle (median) number of days your own listings took from going up to selling —
// the same category's when at least three of them sold, else all of yours when at least three did. With fewer,
// there is no "usually": the nudge waits two weeks and says only how long it has been. The days count from the ad
// going up, or from the last price change after it (a cut starts the wait again, so a nudge never follows the cut
// it asked for). Only a listing for sale is nudged; one sold, withdrawn or only written is not.

import { daysBetween } from './ownModel'
import type { ListingPrice, ShopListing } from './resaleTypes'

/** How many sold listings make a "usually". */
export const NUDGE_MIN_SOLD = 3
/** With no "usually": days at one price before the nudge. */
export const NUDGE_DEFAULT_DAYS = 14

/** The price now: the price story's last step. */
export function priceNow(l: Pick<ShopListing, 'prices'>): number {
  return l.prices[l.prices.length - 1].price
}

/** The asking price when listed: the first step. */
export function firstPrice(l: Pick<ShopListing, 'prices'>): number {
  return l.prices[0].price
}

/** Days from the ad going up to the sale (a sale straight from Listed counts from the day it was written); null unless sold. */
export function daysToSell(l: Pick<ShopListing, 'status' | 'listed_on' | 'for_sale_on' | 'ended_on'>): number | null {
  if (l.status !== 'sold' || !l.ended_on) return null
  return Math.max(0, daysBetween(l.for_sale_on ?? l.listed_on, l.ended_on))
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

export interface TypicalDays {
  /** The median days to sell. */
  days:  number
  /** How many sold listings it comes from. */
  count: number
  /** 'category': the same category's listings; 'all': all of yours. */
  scope: 'category' | 'all'
}

/**
 * How long your listings usually take to sell: the same category's (listings whose thing is in `sameCategory`)
 * when at least NUDGE_MIN_SOLD sold, else all of yours when at least that many did, else null.
 */
export function typicalDaysToSell(listings: readonly ShopListing[], sameCategory?: ReadonlySet<string> | null): TypicalDays | null {
  const sold = listings.map(l => ({ l, d: daysToSell(l) })).filter((x): x is { l: ShopListing; d: number } => x.d !== null)
  const inCategory = sameCategory ? sold.filter(x => sameCategory.has(x.l.item_id)) : []
  if (inCategory.length >= NUDGE_MIN_SOLD) return { days: median(inCategory.map(x => x.d)), count: inCategory.length, scope: 'category' }
  if (sold.length >= NUDGE_MIN_SOLD) return { days: median(sold.map(x => x.d)), count: sold.length, scope: 'all' }
  return null
}

/** The day the wait at this price began: the ad going up, or a later price change. Null unless for sale. */
export function waitingSince(l: Pick<ShopListing, 'status' | 'for_sale_on' | 'prices'>): string | null {
  if (l.status !== 'for_sale' || !l.for_sale_on) return null
  const last = l.prices[l.prices.length - 1].on
  return last > l.for_sale_on ? last : l.for_sale_on
}

export interface ListingNudge {
  listingId: string
  itemId:    string
  /** Days since it went up. */
  days:      number
  /** Days at the price now (since the last change after it went up). */
  atPrice:   number
  /** Whether the price was changed after it went up. */
  lowered:   boolean
  typical:   TypicalDays | null
  words:     string
}

const dayWord = (n: number) => `${n} day${n === 1 ? '' : 's'}`

/**
 * The nudge for one listing on `today`, or null: only while it is for sale and has waited at its price longer than
 * yours usually take (or NUDGE_DEFAULT_DAYS with no "usually"). `history` is every listing of yours (this one may
 * be among them); `sameCategory` the ids of your things in this thing's category.
 */
export function listingNudge(listing: ShopListing, history: readonly ShopListing[], today: string,
  sameCategory?: ReadonlySet<string> | null): ListingNudge | null {
  const since = waitingSince(listing)
  if (!since || !listing.for_sale_on) return null
  const days = Math.max(0, daysBetween(listing.for_sale_on, today))
  const atPrice = Math.max(0, daysBetween(since, today))
  const typical = typicalDaysToSell(history.filter(l => l.id !== listing.id), sameCategory)
  if (atPrice <= (typical?.days ?? NUDGE_DEFAULT_DAYS)) return null
  const lowered = since !== listing.for_sale_on
  const waited = lowered ? `${dayWord(atPrice)} at this price, no sale` : `${dayWord(days)}, no sale`
  const words = typical ? `${waited}; yours usually go in ${typical.days} — lower it?` : `${waited} — lower it?`
  return { listingId: listing.id, itemId: listing.item_id, days, atPrice, lowered, typical, words }
}

/**
 * The price story with a new price from `on`: added at the end, or — on the day of the last step — in its place
 * (one price a day), so the story stays in order. A step before the last one's day is refused (null).
 */
export function withPriceChange(prices: readonly ListingPrice[], price: number, on: string): ListingPrice[] | null {
  const last = prices[prices.length - 1]
  if (!last) return [{ on, price }]
  if (on < last.on) return null
  return on === last.on ? [...prices.slice(0, -1), { on, price }] : [...prices, { on, price }]
}
