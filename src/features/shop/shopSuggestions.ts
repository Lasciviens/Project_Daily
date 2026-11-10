// "Needs a look" (phase 2 prototype): what in the Shop wants doing now and the
// money at stake, from the data already there. No dismissal yet (it comes with
// the build). Pure — scripts/verify-shop-suggestions.cjs.
import { formatDate } from '../../shared/utils/dateFormat'
import { formatMoney } from '../settings/subscriptionRules'
import { daysBetween, isMine, isPossession, PAID_BACK, valueAgeDays, VALUE_STALE_DAYS } from './ownModel'
import { currencyOf, listOf, localDay, watchedPrice, type Money } from './shopModel'
import { atTarget } from './wishTile'
import type { ShopItem, ShopPriceWatch } from './types'

export type LookKind = 'return' | 'cheaper' | 'at_target' | 'complaint' | 'value' | 'wish' | 'tidy'
/** Danger: due today or tomorrow · warn: money to claim or ≤ 3 days · success: good news · info: dates and tidy-up. */
export type LookTone = 'danger' | 'warn' | 'success' | 'info'
/** The row's one action: open the thing, mark it bought, or open it at its "Could sell for". */
export type LookAction = 'open' | 'bought' | 'value'

export interface Look {
  key: string
  kind: LookKind
  tone: LookTone
  /** The thing a tap opens (tidy-up: the first of them). */
  itemId: string
  title: string
  /** What is due and the money involved, as short facts: "Return by 11.11.2026", "tomorrow", "paid 1 990 NOK". */
  facts: string[]
  /** Where a price was read ("at elkjop.no"): from the link, so of any length — the one part that may wrap. */
  where: string | null
  action: LookAction
  /** Money you can get back: cheaper now than you paid, while it can still be returned. */
  claim: Money | null
  /** Days until it is due (a deadline), else null. */
  daysLeft: number | null
  /** Within a kind: the older first (a wish, an estimate). */
  order: number
}

/** About six months, as Owned's "update it" on an old "Could sell for". */
export const WISH_OLD_DAYS = VALUE_STALE_DAYS
export const RETURN_SOON_DAYS = 3
export const COMPLAINT_SOON_DAYS = 60
/** Norges Bank publishes after 16:00 on weekdays, and the page fetches what waits: a rate still missing after three days needs a hand. */
export const RATE_GRACE_DAYS = 3

const TONE_RANK: Record<LookTone, number> = { danger: 0, warn: 1, success: 2, info: 3 }
const KIND_RANK: Record<LookKind, number> = { return: 0, cheaper: 1, at_target: 2, complaint: 3, value: 4, wish: 5, tidy: 6 }

const money = (n: number, currency: string) => formatMoney(Math.round(n), currency)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** "today", "tomorrow", "in 5 days". */
export function whenWords(daysLeft: number): string {
  return daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
}

/** A deadline's tone: today or tomorrow danger, within three days warn, else `later`. */
function deadlineTone(daysLeft: number, later: LookTone): LookTone {
  return daysLeft <= 1 ? 'danger' : daysLeft <= RETURN_SOON_DAYS ? 'warn' : later
}

/** Where a watch read its price: "Prisjakt" or the shop's site ("elkjop.no"); never a non-web link. */
function siteOf(item: ShopItem, watch: ShopPriceWatch | null | undefined): string | null {
  if (watch?.source === 'prisjakt') return 'Prisjakt'
  try {
    const u = new URL(item.url ?? '')
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.replace(/^www\./, '') : null
  } catch { return null }
}

const paidWords = (i: ShopItem): string | null => (i.price != null ? `paid ${money(i.price, currencyOf(i))}` : null)
const foreign = (c: string | null | undefined) => !!c && c.toUpperCase() !== 'NOK'
const facts = (...xs: (string | null | false | undefined)[]): string[] => xs.filter((x): x is string => !!x)

/** A wish's price for its row: its own (a general wish's range), never a guess. */
function wishPrice(i: ShopItem, watch: ShopPriceWatch | null | undefined): string | null {
  const now = watchedPrice(i, watch)
  if (now) return money(now.amount, now.currency)
  if (i.kind === 'general' && (i.price_min != null || i.price_max != null)) {
    const lo = i.price_min ?? i.price_max as number, hi = i.price_max ?? i.price_min as number
    return lo === hi ? money(lo, currencyOf(i)) : `${money(lo, currencyOf(i)).replace(/\s\S+$/, '')}–${money(hi, currencyOf(i))}`
  }
  return i.price != null ? money(i.price, currencyOf(i)) : null
}

/** What a possession lacks for its numbers: its purchase day, a rate, the money a sale brought. */
export function tidyReasons(i: ShopItem, today: string): { noDay: boolean; rate: boolean; noAmount: boolean } {
  const boughtDay = i.bought_at ? localDay(i.bought_at) : null
  const waited = (day: string | null | undefined) => !day || daysBetween(day, today) >= RATE_GRACE_DAYS
  return {
    // Null, not absent: before migration 134 a row has no such column at all.
    noDay: i.bought_at === null,
    rate: (foreign(i.currency) && i.price != null && i.fx_nok === null && waited(boughtDay))
      || (foreign(i.sale_currency) && i.sale_price != null && i.sale_fx_nok === null && waited(i.disposed_on)),
    noAmount: !!i.disposal && PAID_BACK.includes(i.disposal) && i.sale_price == null,
  }
}

/**
 * Everything that needs a look, most urgent first: a return window closing,
 * a price under what you paid while you can still return it, a wish at its
 * target, a complaint right ending, an old "Could sell for", a wish waiting
 * half a year, and one row counting what to tidy up.
 */
export function needsALook(items: readonly ShopItem[], watches: ReadonlyMap<string, ShopPriceWatch>, today: string): Look[] {
  const out: Look[] = []
  const tidy = { things: [] as ShopItem[], noDay: 0, rate: 0, noAmount: 0 }
  const push = (l: Omit<Look, 'key' | 'title' | 'claim' | 'daysLeft' | 'order' | 'where'> & Partial<Pick<Look, 'claim' | 'daysLeft' | 'order' | 'where'>>, i: ShopItem) =>
    out.push({ key: `${l.kind}:${i.id}`, title: i.title, claim: null, daysLeft: null, order: 0, where: null, ...l })

  for (const i of items) {
    const watch = watches.get(i.id)
    if (listOf(i) === 'wishlist' && i.status === 'wishlist') {
      if (i.kind !== 'general' && atTarget(i, watch)) {
        const now = watchedPrice(i, watch) as Money
        const site = siteOf(i, watch)
        push({ kind: 'at_target', tone: 'success', itemId: i.id, action: 'bought', where: site ? `at ${site}` : null,
          facts: facts('At your target', money(now.amount, now.currency)) }, i)
      }
      const age = daysBetween(localDay(i.created_at), today)
      // A general wish's models are counted through the wish.
      if (!i.option_for && age > WISH_OLD_DAYS) {
        push({ kind: 'wish', tone: 'info', itemId: i.id, action: 'open', order: -age,
          facts: facts(`On the wishlist since ${formatDate(localDay(i.created_at))}`, wishPrice(i, watch)) }, i)
      }
      continue
    }
    if (!isPossession(i)) continue

    const why = tidyReasons(i, today)
    if (why.noDay || why.rate || why.noAmount) {
      tidy.things.push(i)
      tidy.noDay += Number(why.noDay); tidy.rate += Number(why.rate); tidy.noAmount += Number(why.noAmount)
    }
    if (!isMine(i)) continue

    let claimed = false
    if (i.return_by && i.return_by >= today) {
      const left = daysBetween(today, i.return_by)
      const now = watchedPrice(i, watch)
      if (now && i.price != null && now.currency === currencyOf(i) && now.amount < i.price) {
        claimed = true
        const claim = { currency: now.currency, amount: i.price - now.amount }
        push({ kind: 'cheaper', tone: deadlineTone(left, 'warn'), itemId: i.id, action: 'open', claim, daysLeft: left,
          facts: facts(`${money(claim.amount, claim.currency)} cheaper than you paid`, `return by ${formatDate(i.return_by)}`, whenWords(left)) }, i)
      }
      if (!claimed && left <= RETURN_SOON_DAYS) {
        push({ kind: 'return', tone: deadlineTone(left, 'warn'), itemId: i.id, action: 'open', daysLeft: left,
          facts: facts(`Return by ${formatDate(i.return_by)}`, whenWords(left), paidWords(i)) }, i)
      }
    }
    if (i.warranty_until && i.warranty_until >= today) {
      const left = daysBetween(today, i.warranty_until)
      if (left <= COMPLAINT_SOON_DAYS) {
        push({ kind: 'complaint', tone: deadlineTone(left, 'info'), itemId: i.id, action: 'open', daysLeft: left,
          facts: facts(`Can complain until ${formatDate(i.warranty_until)}`, whenWords(left), paidWords(i)) }, i)
      }
    }
    const valueAge = valueAgeDays(i, today)
    if (i.value_now != null && valueAge != null && valueAge > VALUE_STALE_DAYS) {
      push({ kind: 'value', tone: 'info', itemId: i.id, action: 'value', order: -valueAge,
        facts: facts(`Could sell for ${money(i.value_now, i.value_currency ?? 'NOK')}`, `estimated ${formatDate(i.value_on)}`) }, i)
    }
  }

  if (tidy.things.length) {
    const first = tidy.things[0]
    out.push({
      key: 'tidy', kind: 'tidy', tone: 'info', itemId: first.id, action: 'open', claim: null, daysLeft: null, order: 0, where: null,
      title: `${plural(tidy.things.length, 'thing')} to tidy up`,
      facts: facts(
        tidy.noDay > 0 && `${tidy.noDay} without a purchase day`,
        tidy.rate > 0 && plural(tidy.rate, 'rate') + ' pending',
        tidy.noAmount > 0 && `${plural(tidy.noAmount, 'sale')} without an amount`,
      ),
    })
  }
  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]
    || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)
    || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || a.order - b.order
    || a.title.localeCompare(b.title, 'en'))
}

/** The phone's one line: "3 need a look · 500 NOK to claim", in the most urgent row's tone. */
export interface LookLine { count: number; tone: LookTone | null; words: string; claim: string | null }

export function lookLine(looks: readonly Look[]): LookLine {
  if (!looks.length) return { count: 0, tone: null, words: 'Nothing needs a look', claim: null }
  const sums = new Map<string, number>()
  for (const l of looks) if (l.claim) sums.set(l.claim.currency, (sums.get(l.claim.currency) ?? 0) + l.claim.amount)
  const claim = sums.size ? `${[...sums].map(([c, a]) => money(a, c)).join(' + ')} to claim` : null
  return { count: looks.length, tone: looks[0].tone, words: `${looks.length} need${looks.length === 1 ? 's' : ''} a look`, claim }
}
