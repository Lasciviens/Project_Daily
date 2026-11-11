// What a thing could sell for, from evidence you can see (Shop step C; owner, 10.11.2026: "It knows what things
// are worth — from evidence you can see, never invented"). Pure — scripts/verify-shop-resale.cjs.
//
// The evidence list per thing, newest first, each row with its source, day and condition:
//   · your own past sales of the same model (another row with the same barcode or the same name: sold, traded in);
//   · ads you noted for it (shop_ad_notes): what sellers ask ("asking, not sold"), or what one sold for;
//   · dealers' used and refurbished prices from the thing's own price watch (188's used_low / refurbished_low —
//     offers seen, never a "Could sell for" by themselves);
//   · trade-in quotes you typed (the floor: a dealer pays at least that);
//   · your own past estimates (shop_value_history, and the current "Could sell for") — shown, never counted:
//     an estimate built from your estimates would only repeat them.
// A suggested range comes only from rows that count — fresh (from the last six months, the age "Could sell for"
// goes old at), not "for parts", with a NOK amount — and only when there is any: sold and asked prices span it,
// the trade-in floor lifts its low end, a dealer's used or refurbished price caps its high end (a buyer gets a
// shop's warranty for that). Nothing is ever filled in by itself: the range is a suggestion the owner taps to use.

import { formatDate } from '../../shared/utils/dateFormat'
import { complete, daysBetween, isPossession, nokAt, nokNow, VALUE_STALE_DAYS } from './ownModel'
import { localDay } from './shopModel'
import type { UsdRates } from './fx'
import type { ResaleCondition, ShopAdNote, ShopTradeInQuote, ShopValuePoint } from './resaleTypes'
import type { ShopItem, ShopPriceWatch } from './types'

export type EvidenceKind =
  | 'own_sale' | 'own_trade_in' | 'ad_sold' | 'ad_ask' | 'dealer_used' | 'dealer_refurbished' | 'trade_in' | 'estimate'

/** How each kind counts in the range: a price people pay or ask, a floor, a cap, or not at all. */
export const EVIDENCE_ROLE: Readonly<Record<EvidenceKind, 'market' | 'floor' | 'cap' | 'shown'>> = {
  own_sale: 'market', ad_sold: 'market', ad_ask: 'market',
  own_trade_in: 'floor', trade_in: 'floor',
  dealer_used: 'cap', dealer_refurbished: 'cap',
  estimate: 'shown',
}

/** Evidence older than this many days is listed, never counted (the age a "Could sell for" goes old). */
export const EVIDENCE_FRESH_DAYS = VALUE_STALE_DAYS

export interface ResaleEvidenceRow {
  kind:      EvidenceKind
  amount:    number
  currency:  string
  /** In NOK: a sale at its own day's rate, anything else at today's; null while a rate is missing. */
  nok:       number | null
  /** yyyy-mm-dd */
  on:        string
  condition: ResaleCondition | 'used' | 'refurbished' | null
  /** Plain words: where it is from ("finn.no ad", "A store's trade-in quote", "Your estimate"). */
  source:    string
  /** An ad's link (never fetched; shown with its address), else null. */
  link:      string | null
  /** The row it comes from (an ad note's, a quote's, a history row's or a thing's id). */
  ref:       string
  /** Whether it counts in the suggested range; `why` says why not. */
  counts:    boolean
  why:       string | null
}

export interface ResaleRange {
  /** NOK; null when only a cap is known ("up to"). */
  low:   number | null
  /** NOK; null when only a floor is known ("at least"). */
  high:  number | null
  /** The middle, to the nearest 10 NOK — what Use offers; null without both ends. */
  mid:   number | null
  /** How many rows it is built from. */
  count: number
  /** "From 2 asks, 1 sale and a trade-in quote". */
  basis: string
}

export interface ResaleEvidenceInput {
  item:    ShopItem
  /** Every row (the owner's own past sales are found among them). */
  items:   readonly ShopItem[]
  adNotes: readonly ShopAdNote[]
  quotes:  readonly ShopTradeInQuote[]
  values:  readonly ShopValuePoint[]
  /** The thing's own price watch, if it has one. */
  watch:   ShopPriceWatch | null
  /** Today's rates (for amounts of now in another currency). */
  rates:   UsdRates | null
  /** yyyy-mm-dd */
  today:   string
}

export interface ResaleEvidence {
  rows:  ResaleEvidenceRow[]
  range: ResaleRange | null
}

/** A name to compare models by: no case, accents folded, only letters and digits ("Sony WH-1000XM5" = "sony wh 1000xm5"). */
export function modelKey(title: string): string {
  return title.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('nb').replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Another of the owner's things that is the same model: the same barcode, or the same name. */
export function sameModel(a: Pick<ShopItem, 'id' | 'title' | 'ean'>, b: Pick<ShopItem, 'id' | 'title' | 'ean'>): boolean {
  if (a.id === b.id) return false
  if (a.ean && b.ean) return a.ean.trim() === b.ean.trim()
  const k = modelKey(a.title)
  return k.length > 0 && k === modelKey(b.title)
}

const roundTo10 = (n: number) => Math.round(n / 10) * 10

function nokOf(amount: number, currency: string, rates: UsdRates | null, frozen?: number | null): number | null {
  const a = frozen === undefined ? nokNow(amount, currency, rates) : nokAt(amount, currency, frozen)
  return complete(a) ? a.nok : null
}

/** Why a row doesn't count (null: it counts). */
function whyNot(kind: EvidenceKind, on: string, condition: ResaleEvidenceRow['condition'], nok: number | null, today: string): string | null {
  if (kind === 'estimate') return 'your own estimate'
  if (condition === 'for_parts') return 'for parts'
  if (daysBetween(on, today) > EVIDENCE_FRESH_DAYS) return 'older than six months'
  if (on > today) return 'dated after today'
  return nok === null ? 'no rate yet' : null
}

/** The thing's evidence list, newest first. */
export function evidenceRows(input: ResaleEvidenceInput): ResaleEvidenceRow[] {
  const { item, items, adNotes, quotes, values, watch, rates, today } = input
  const rows: Omit<ResaleEvidenceRow, 'counts' | 'why'>[] = []

  for (const o of items) {
    if (!isPossession(o) || !sameModel(item, o) || o.sale_price == null || !Number.isFinite(o.sale_price) || !o.disposed_on) continue
    if (o.disposal !== 'sold' && o.disposal !== 'traded_in') continue
    const currency = o.sale_currency ?? o.currency ?? 'NOK'
    rows.push({
      kind: o.disposal === 'sold' ? 'own_sale' : 'own_trade_in', amount: o.sale_price, currency,
      nok: nokOf(o.sale_price, currency, rates, o.sale_fx_nok ?? null), on: o.disposed_on, condition: null,
      source: o.disposal === 'sold' ? 'You sold one' : 'You traded one in', link: null, ref: o.id,
    })
  }
  for (const n of adNotes) {
    if (n.item_id !== item.id) continue
    rows.push({
      kind: n.asking ? 'ad_ask' : 'ad_sold', amount: n.price, currency: n.currency, nok: nokOf(n.price, n.currency, rates),
      on: n.noted_on, condition: n.condition, source: `${n.marketplace ?? 'Ad'}${n.marketplace ? ' ad' : ''}${n.asking ? ', asking' : ', sold'}`,
      link: n.ad_url, ref: n.id,
    })
  }
  if (watch && watch.item_id === item.id) {
    const seen = watch.last_ok_at ?? watch.checked_at
    const on = seen ? localDay(seen) : null
    const currency = watch.currency ?? 'NOK'
    for (const [kind, amount, condition, words] of [
      ['dealer_used', watch.used_low, 'used', 'Cheapest used offer on Prisjakt'],
      ['dealer_refurbished', watch.refurbished_low, 'refurbished', 'Cheapest refurbished offer on Prisjakt'],
    ] as const) {
      if (on && amount != null && Number.isFinite(amount) && amount >= 0) {
        rows.push({ kind, amount, currency, nok: nokOf(amount, currency, rates), on, condition, source: words, link: null, ref: `watch:${item.id}` })
      }
    }
  }
  for (const q of quotes) {
    if (q.item_id !== item.id) continue
    rows.push({
      kind: 'trade_in', amount: q.amount, currency: q.currency, nok: nokOf(q.amount, q.currency, rates), on: q.quoted_on,
      condition: q.condition, source: `${q.dealer}'s trade-in quote`, link: null, ref: q.id,
    })
  }
  const estimateDays = new Set<string>()
  for (const v of values) {
    if (v.item_id !== item.id) continue
    estimateDays.add(v.valued_on)
    rows.push({ kind: 'estimate', amount: v.value, currency: v.currency, nok: nokOf(v.value, v.currency, rates), on: v.valued_on,
      condition: null, source: 'Your estimate', link: null, ref: v.id })
  }
  // An estimate from before the history began (192) is the thing's own "Could sell for".
  if (item.value_now != null && Number.isFinite(item.value_now) && item.value_on && !estimateDays.has(item.value_on)) {
    const currency = item.value_currency ?? 'NOK'
    rows.push({ kind: 'estimate', amount: item.value_now, currency, nok: nokOf(item.value_now, currency, rates), on: item.value_on,
      condition: null, source: 'Your estimate', link: null, ref: item.id })
  }

  return rows
    .map(r => {
      const why = whyNot(r.kind, r.on, r.condition, r.nok, today)
      return { ...r, counts: why === null, why }
    })
    .sort((a, b) => b.on.localeCompare(a.on) || a.kind.localeCompare(b.kind) || a.ref.localeCompare(b.ref))
}

const PLURAL: Record<EvidenceKind, [string, string]> = {
  own_sale: ['sale of yours', 'sales of yours'], own_trade_in: ['trade-in of yours', 'trade-ins of yours'],
  ad_sold: ['sold ad', 'sold ads'], ad_ask: ['ask', 'asks'], dealer_used: ['used offer', 'used offers'],
  dealer_refurbished: ['refurbished offer', 'refurbished offers'], trade_in: ['trade-in quote', 'trade-in quotes'], estimate: ['estimate', 'estimates'],
}
const ORDER: readonly EvidenceKind[] = ['own_sale', 'ad_sold', 'ad_ask', 'own_trade_in', 'trade_in', 'dealer_used', 'dealer_refurbished']

function basisWords(rows: readonly ResaleEvidenceRow[]): string {
  const parts = ORDER.map(k => {
    const n = rows.filter(r => r.kind === k).length
    return n ? `${n} ${PLURAL[k][n === 1 ? 0 : 1]}` : null
  }).filter((p): p is string => p !== null)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? ''
  return list ? `From ${list}` : ''
}

/**
 * The suggested range from the rows that count (null when none does). Sold and asked prices span it; the highest
 * trade-in quote lifts its low end (a dealer pays at least that — above every price seen it is the range); the
 * lowest dealer used or refurbished price caps its high end, never below its low end. With no price seen, a quote
 * and a cap make the range; one alone is "at least" or "up to".
 */
export function suggestedRange(rows: readonly ResaleEvidenceRow[]): ResaleRange | null {
  const used = rows.filter(r => r.counts && r.nok !== null)
  const of = (role: 'market' | 'floor' | 'cap') => used.filter(r => EVIDENCE_ROLE[r.kind] === role).map(r => r.nok as number)
  const market = of('market'), floors = of('floor'), caps = of('cap')
  if (!used.length) return null
  const floor = floors.length ? Math.max(...floors) : null
  const cap = caps.length ? Math.min(...caps) : null
  let low: number | null
  let high: number | null
  if (market.length) {
    low = Math.min(...market)
    high = Math.max(...market)
    if (cap !== null && cap < high) high = Math.max(cap, low)
    if (floor !== null && floor > low) low = Math.min(floor, high)
    if (floor !== null && floor > high) low = high = floor
  } else {
    low = floor
    high = cap !== null && floor !== null ? Math.max(cap, floor) : cap
  }
  return {
    low, high, mid: low !== null && high !== null ? roundTo10((low + high) / 2) : null,
    count: used.length, basis: basisWords(used),
  }
}

/** The thing's evidence and the range it suggests. Nothing is written: Use is the owner's tap. */
export function resaleEvidence(input: ResaleEvidenceInput): ResaleEvidence {
  const rows = evidenceRows(input)
  return { rows, range: suggestedRange(rows) }
}

/** "2 400 NOK · finn.no ad, asking · like new · 10.11.2026" — one evidence row in words (the amount in its own currency). */
export function evidenceLine(r: ResaleEvidenceRow, money: (n: number, currency: string) => string): string {
  const condition = r.condition ? CONDITION_LABEL[r.condition] : null
  return [money(r.amount, r.currency), r.source, condition, formatDate(r.on), r.why ? `not counted: ${r.why}` : null].filter(Boolean).join(' · ')
}

/** A condition in the app's words, inside a line ("2 400 NOK · FINN · like new · 03.11.2026"). */
export const CONDITION_LABEL: Readonly<Record<ResaleCondition | 'used' | 'refurbished', string>> = {
  new: 'new, unused', like_new: 'like new', good: 'good', fair: 'fair', for_parts: 'for parts', used: 'used', refurbished: 'refurbished',
}

/** A condition as a choice of its own (a select's option): "Like new" (cleanup, 11.11.2026: the options were lowercase). */
export const conditionChoice = (c: ResaleCondition): string => CONDITION_LABEL[c].charAt(0).toUpperCase() + CONDITION_LABEL[c].slice(1)
