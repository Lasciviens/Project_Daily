// New vs used vs refurbished: what owning it would cost you, net, using your own "kept %" (Shop step C). Pure —
// scripts/verify-shop-resale.cjs.
//
// "Kept %" is the share of what you paid that came back when a thing of yours left with money — a sale or a
// trade-in, each at the rate of its own day (paidOf / gotOf): bought for 5 000, sold for 3 000 = 60 %. It comes
// from your own sales only, the middle (median) one: the same category's when at least three of yours left with
// money, else all of yours (at least one). Things you bought new and things you bought used are counted apart —
// a used one has already lost its first drop — when there are enough of that kind; a refurbished one counts as
// used (it sells as a used one). Gifts, things without a price or without a complete amount are left out.
//
// The net cost of an option is its price less what you would get back at that share; per month, over the months
// your sold things were usually kept. Nothing is guessed: no kept % → no net cost, and the note says why.

import { complete, gotOf, isPossession, monthsBetween, nokNow, paidOf, boughtOn } from './ownModel'
import { currencyOf } from './shopModel'
import type { UsdRates } from './fx'
import type { ShopCategory, ShopItem, ShopPriceWatch } from './types'

/** How many sales of one category make its own kept %. */
export const KEPT_MIN_CATEGORY = 3

export interface KeptSale { id: string; share: number; months: number | null; used: boolean; categoryId: string | null }

/** Your things that left with money (sold, traded in) and the share of the price that came back. */
export function keptSales(items: readonly ShopItem[]): KeptSale[] {
  const out: KeptSale[] = []
  for (const i of items) {
    if (!isPossession(i) || (i.disposal !== 'sold' && i.disposal !== 'traded_in') || i.got_as_gift) continue
    const paid = paidOf(i), got = gotOf(i)
    if (!got || !complete(paid) || !complete(got) || !(paid.nok > 0)) continue
    const from = boughtOn(i)
    out.push({
      id: i.id, share: got.nok / paid.nok, used: !!i.used, categoryId: i.category_id,
      months: from && i.disposed_on ? monthsBetween(from, i.disposed_on) : null,
    })
  }
  return out
}

export interface KeptShare {
  /** The median share that came back (0.6 = 60 %; above 1 = sold for more than it cost). */
  share:  number
  /** The share as a whole percent. */
  pct:    number
  count:  number
  /** The median months those things were kept (null when no day is known). */
  months: number | null
  scope:  'category' | 'all'
  /** Which purchases it is from: bought new, bought used, or both (too few of one kind). */
  bought: 'new' | 'used' | 'any'
}

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function shareOf(sales: readonly KeptSale[], scope: KeptShare['scope'], bought: KeptShare['bought']): KeptShare {
  const share = median(sales.map(s => s.share))
  const months = sales.map(s => s.months).filter((m): m is number => m !== null)
  return { share, pct: Math.round(share * 100), count: sales.length, months: months.length ? median(months) : null, scope, bought }
}

/**
 * Your kept % for a purchase: of the category (`categoryIds`: the thing's category and its subcategories) when at
 * least KEPT_MIN_CATEGORY of yours sold there, else of all your sales; of things bought the same way (`used`) when
 * that scope has enough of them, else of both kinds. Null with no sale at all.
 */
export function keptShare(items: readonly ShopItem[], categoryIds: ReadonlySet<string> | null, used: boolean | null): KeptShare | null {
  const sales = keptSales(items)
  const inCategory = categoryIds ? sales.filter(s => s.categoryId !== null && categoryIds.has(s.categoryId)) : []
  const [pool, scope] = inCategory.length >= KEPT_MIN_CATEGORY ? [inCategory, 'category' as const] : [sales, 'all' as const]
  if (!pool.length) return null
  if (used !== null) {
    const sameKind = pool.filter(s => s.used === used)
    const enough = scope === 'category' ? KEPT_MIN_CATEGORY : 1
    if (sameKind.length >= enough) return shareOf(sameKind, scope, used ? 'used' : 'new')
  }
  return shareOf(pool, scope, 'any')
}

export type OwnershipKind = 'new' | 'used' | 'refurbished'

export interface OwnershipOption {
  kind:     OwnershipKind
  price:    number
  currency: string
  /** The price in NOK at today's rate (null while the rate is missing). */
  priceNok: number | null
  kept:     KeptShare | null
  /** What you would get back, NOK. */
  getBack:  number | null
  /** The price less what comes back, NOK (below 0: it would make money). */
  net:      number | null
  /** The net cost over the months yours were usually kept, NOK a month. */
  perMonth: number | null
}

export interface OwnershipCostInput {
  items:       readonly ShopItem[]
  /** The thing's category and its subcategories (null: none). */
  categoryIds: ReadonlySet<string> | null
  /** The prices to compare, in `currency` (a missing one is left out). */
  prices:      Partial<Record<OwnershipKind, number | null>>
  currency:    string
  rates:       UsdRates | null
}

export interface OwnershipCost {
  options:  OwnershipOption[]
  /** The option with the lowest net cost (null when none has one). */
  cheapest: OwnershipKind | null
  /** Why a net cost is missing, in plain words (null when every option has one). */
  note:     string | null
}

const KINDS: readonly OwnershipKind[] = ['new', 'used', 'refurbished']

/** The net cost of each option, from your own kept %. */
export function ownershipCost(input: OwnershipCostInput): OwnershipCost {
  const options: OwnershipOption[] = []
  for (const kind of KINDS) {
    const price = input.prices[kind]
    if (price == null || !Number.isFinite(price) || price < 0) continue
    const nok = nokNow(price, input.currency, input.rates)
    const priceNok = complete(nok) ? nok.nok : null
    const kept = keptShare(input.items, input.categoryIds, kind !== 'new')
    const getBack = kept && priceNok !== null ? Math.round(priceNok * kept.share) : null
    const net = getBack !== null && priceNok !== null ? Math.round(priceNok - getBack) : null
    const perMonth = net !== null && kept?.months ? Math.round(net / kept.months) : null
    options.push({ kind, price, currency: input.currency, priceNok, kept, getBack, net, perMonth })
  }
  const priced = options.filter(o => o.net !== null)
  const cheapest = priced.length ? priced.reduce((a, b) => ((b.net as number) < (a.net as number) ? b : a)).kind : null
  const note = !options.length ? 'No price to compare yet'
    : options.some(o => o.priceNok === null) ? 'A price waits for today\'s rate'
    : options.some(o => !o.kept) ? 'None of your things has been sold or traded in with a price yet — your own kept % comes from those'
    : null
  return { options, cheapest, note }
}

// ── A wish's record: what to compare ─────────────────────────────────────────

/** The thing's category and its subcategories (the scope of its kept %); null without a category. */
export function categoryScope(categoryId: string | null, categories: readonly Pick<ShopCategory, 'id' | 'parent_id'>[]): Set<string> | null {
  if (!categoryId) return null
  return new Set([categoryId, ...categories.filter(c => c.parent_id === categoryId).map(c => c.id)])
}

export interface OwnershipPrices {
  prices:   Partial<Record<OwnershipKind, number>>
  currency: string
  /** Where the new price is from: the clean read of the wish's own link, or the wish's own price. */
  newFrom:  'read' | 'yours' | null
}

const usable = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0

/**
 * A wish's prices to compare. New: the last clean read of its own link (Prisjakt's new offers or a shop's own
 * page — never a mixed or pre-188 figure, which may be a used one), else the wish's own price. Used and
 * refurbished: Prisjakt's cheapest such offers on that read (offers to buy — never a "Could sell for"), only in
 * the new price's currency. A link whose site doesn't let apps read it has no read. Nothing is guessed.
 */
export function ownershipPrices(
  item: Pick<ShopItem, 'id' | 'url' | 'price' | 'currency' | 'region'>,
  watch: ShopPriceWatch | null | undefined,
): OwnershipPrices {
  const own = watch && item.url && watch.item_id === item.id && watch.url === item.url && watch.status !== 'not_allowed' ? watch : null
  const readCurrency = (own?.currency ?? 'NOK').toUpperCase()
  const prices: OwnershipPrices['prices'] = {}
  let currency: string = currencyOf(item)
  let newFrom: OwnershipPrices['newFrom'] = null
  if (own && usable(own.low) && (own.condition === 'new' || own.condition === 'unknown')) {
    prices.new = own.low
    currency = readCurrency
    newFrom = 'read'
  } else if (usable(item.price)) {
    prices.new = item.price
    newFrom = 'yours'
  } else if (own) {
    currency = readCurrency
  }
  if (own && readCurrency === currency) {
    if (usable(own.used_low)) prices.used = own.used_low
    if (usable(own.refurbished_low)) prices.refurbished = own.refurbished_low
  }
  return { prices, currency, newFrom }
}

/** Whether the comparison has something to say: two prices or more, or one with its net cost. */
export function worthShowing(cost: OwnershipCost): boolean {
  return cost.options.length >= 2 || (cost.options.length === 1 && cost.options[0].net !== null)
}

/**
 * Where the kept % is from, in one line — "You get back about 60 % new, 65 % used — from 4 of your sales in
 * Phones, kept ≈ 12 months" (a refurbished one counts as used). Null when no option has a kept %.
 */
export function keptWords(cost: OwnershipCost, categoryName: string | null): string | null {
  const withKept = cost.options.filter((o): o is OwnershipOption & { kept: KeptShare } => o.kept !== null)
  if (!withKept.length) return null
  const newKept = withKept.find(o => o.kind === 'new')?.kept
  const usedKept = withKept.find(o => o.kind !== 'new')?.kept
  const pcts = [newKept && ['new', newKept.pct] as const, usedKept && ['used', usedKept.pct] as const].filter(Boolean) as (readonly [string, number])[]
  const share = pcts.length === 2 && pcts[0][1] !== pcts[1][1] ? pcts.map(([k, p]) => `${p} % ${k}`).join(', ') : `${pcts[0][1]} %`
  const widest = withKept.map(o => o.kept).reduce((a, b) => (b.count > a.count ? b : a))
  const from = widest.count === 1 ? 'your one sale' : `${widest.count} of your sales`
  const where = widest.scope === 'category' && categoryName ? ` in ${categoryName}` : ''
  const m = widest.months !== null ? Math.round(widest.months) : null
  return `You get back about ${share} — from ${from}${where}${m !== null ? `, kept ≈ ${m} month${m === 1 ? '' : 's'}` : ''}`
}
