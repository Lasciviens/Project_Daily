// "Needs a look": what in the Shop wants doing now and the money at stake,
// from the data already there — the rows, their price watch and clean price
// history, and the deal days ahead. Each row can be snoozed for a week or
// put away with Got it (it comes back only when what it says changes).
// Pure — scripts/verify-shop-suggestions.cjs.
import { formatDate } from '../../shared/utils/dateFormat'
import { formatMoney } from '../settings/subscriptionRules'
import { addDays, daysBetween, isMine, isPossession, PAID_BACK, valueAgeDays, VALUE_STALE_DAYS } from './ownModel'
import { currencyOf, listOf, localDay, watchedPrice, type Money } from './shopModel'
import { atTarget, backInStock, cleanPrice, fakeBefore, lowestIn60, type PriceFacts } from './wishTile'
import type { ShopItem, ShopPriceWatch } from './types'

export type LookKind =
  | 'return' | 'cheaper' | 'at_target' | 'lowest' | 'back' | 'fake_before' | 'deal_day' | 'complaint' | 'value' | 'wish' | 'tidy'
/** Danger: due today or tomorrow · warn: money to claim, ≤ 3 days, a "before" price never seen · success: good news · info: dates and tidy-up. */
export type LookTone = 'danger' | 'warn' | 'success' | 'info'
/** The row's one action: open the thing, mark it bought, open it at its "Could sell for", or list the things it counts. */
export type LookAction = 'open' | 'bought' | 'value' | 'list'

/** One of the things a counting row (tidy-up, a deal day) is about. */
export interface LookThing { id: string; title: string; facts: string[] }

export interface Look {
  key: string
  kind: LookKind
  tone: LookTone
  /** The thing it is about; null for a row that counts several (tidy-up, a deal day). */
  itemId: string | null
  title: string
  /** What is due and the money involved, as short facts: "Return by 11.11.2026", "tomorrow", "paid 1 990 NOK". */
  facts: string[]
  /** Where the last fact's price was read ("at elkjop.no", one piece): from the link, so of any length — the one part that may wrap. */
  where: string | null
  action: LookAction
  /** Money you can get back: cheaper now than you paid, while it can still be returned. */
  claim: Money | null
  /** Days until it is due (a deadline or a deal day), else null. */
  daysLeft: number | null
  /** Within a kind: the older first (a wish, an estimate). */
  order: number
  /** What the row says, in short: after Got it it shows again only when this changes. */
  signature: string
  /** What a 'list' row opens. */
  things: LookThing[]
}

/** A deal day ahead (useDealDays): its name and next day. */
export interface DealDay { key: string; name: string; day: string }

/** What the owner did with a row (useSignalStates): snoozed it until a day, or Got it at a signature. */
export interface LookState { item_id: string | null; signal: string; until: string | null; signature: string | null }

/** About six months, as Owned's "update it" on an old "Could sell for". */
export const WISH_OLD_DAYS = VALUE_STALE_DAYS
export const RETURN_SOON_DAYS = 3
export const COMPLAINT_SOON_DAYS = 60
/** Norges Bank publishes after 16:00 on weekdays, and the page fetches what waits: a rate still missing after three days needs a hand. */
export const RATE_GRACE_DAYS = 3
/** A deal day shows from three weeks ahead. */
export const DEAL_AHEAD_DAYS = 21
/** Snooze hides a row for a week. */
export const SNOOZE_DAYS = 7

const TONE_RANK: Record<LookTone, number> = { danger: 0, warn: 1, success: 2, info: 3 }
const KIND_RANK: Record<LookKind, number> = {
  return: 0, cheaper: 1, at_target: 2, lowest: 3, back: 4, fake_before: 5, deal_day: 6, complaint: 7, value: 8, wish: 9, tidy: 10,
}

const money = (n: number, currency: string) => formatMoney(Math.round(n), currency)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** A space a line never breaks at. */
const NBSP = String.fromCharCode(160)

/** "today", "tomorrow", "in 5 days". */
export function whenWords(daysLeft: number): string {
  return daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
}

/** The day a snooze from `today` ends: a week on. */
export function snoozeUntil(today: string): string {
  return addDays(today, SNOOZE_DAYS)
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
const atSite = (item: ShopItem, watch: ShopPriceWatch | null | undefined) => {
  const site = siteOf(item, watch)
  return site ? `at${NBSP}${site}` : null
}

const paidWords = (i: ShopItem): string | null => (i.price != null ? `paid ${money(i.price, currencyOf(i))}` : null)
const foreign = (c: string | null | undefined) => !!c && c.toUpperCase() !== 'NOK'
const facts = (...xs: (string | null | false | undefined)[]): string[] => xs.filter((x): x is string => !!x)
const priceKey = (m: Money) => `${Math.round(m.amount)} ${m.currency}`

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

/** The inputs beside the rows: their last price reads, clean price histories and the deal days ahead. */
export interface LookInputs {
  watches: ReadonlyMap<string, ShopPriceWatch>
  facts?: ReadonlyMap<string, PriceFacts>
  deals?: readonly DealDay[]
}

type Draft = Omit<Look, 'key' | 'title' | 'claim' | 'daysLeft' | 'order' | 'where' | 'things'> & Partial<Pick<Look, 'claim' | 'daysLeft' | 'order' | 'where' | 'things'>>

/**
 * Everything that needs a look, most urgent first: a return window closing,
 * a price under what you paid while you can still return it, a wish at its
 * target, at its lowest in 60 days or back in stock, a "before" price the
 * link never showed, the next deal day for the wishes with a target, a
 * complaint right ending, an old "Could sell for", a wish waiting half a
 * year, and one row counting what to tidy up.
 */
export function needsALook(items: readonly ShopItem[], inputs: LookInputs, today: string): Look[] {
  const out: Look[] = []
  const tidy: LookThing[] = []
  const tally = { noDay: 0, rate: 0, noAmount: 0 }
  const watching: LookThing[] = []
  const push = (l: Draft, i: ShopItem) =>
    out.push({ key: `${l.kind}:${i.id}`, title: i.title, claim: null, daysLeft: null, order: 0, where: null, things: [], ...l })

  for (const i of items) {
    const watch = inputs.watches.get(i.id)
    if (listOf(i) === 'wishlist' && i.status === 'wishlist') {
      // A general wish's models are counted through the wish.
      if (i.option_for) continue
      if (i.kind !== 'general') {
        const f = inputs.facts?.get(i.id) ?? null
        const now = cleanPrice(i, watch)
        const where = atSite(i, watch)
        // One buy signal a wish: the first that holds.
        if (now && atTarget(i, watch)) {
          push({ kind: 'at_target', tone: 'success', itemId: i.id, action: 'bought', where, signature: priceKey(now),
            facts: facts('At your target', money(now.amount, now.currency)) }, i)
        } else if (now && lowestIn60(now, f)) {
          push({ kind: 'lowest', tone: 'success', itemId: i.id, action: 'bought', where, signature: priceKey(now),
            facts: facts('Lowest in 60 days', money(now.amount, now.currency)) }, i)
        } else if (now && backInStock(i, watch, f)) {
          push({ kind: 'back', tone: 'success', itemId: i.id, action: 'bought', where, signature: (watch?.checked_at ?? '').slice(0, 10),
            facts: facts('Back in stock', money(now.amount, now.currency)) }, i)
        }
        if (now && watch?.was != null && fakeBefore(i, watch, f, today)) {
          push({ kind: 'fake_before', tone: 'warn', itemId: i.id, action: 'open', where, signature: `${Math.round(watch.was)} ${now.currency}`,
            facts: facts(`"Before" ${money(watch.was, now.currency)} not seen in 60 days`, `now ${money(now.amount, now.currency)}`) }, i)
        }
        if (i.target_price != null || i.wait_for_deal) {
          watching.push({ id: i.id, title: i.title, facts: facts(
            wishPrice(i, watch) ? `now ${wishPrice(i, watch)}` : 'no price yet',
            i.target_price != null && `target ${money(i.target_price, currencyOf(i))}`,
            i.wait_for_deal && !i.target_price && 'waiting for a deal',
          ) })
        }
      }
      const age = daysBetween(localDay(i.created_at), today)
      if (age > WISH_OLD_DAYS) {
        const price = wishPrice(i, watch)
        push({ kind: 'wish', tone: 'info', itemId: i.id, action: 'open', order: -age, signature: `${localDay(i.created_at)} ${price ?? ''}`.trim(),
          facts: facts(`On the wishlist since ${formatDate(localDay(i.created_at))}`, price) }, i)
      }
      continue
    }
    if (!isPossession(i)) continue

    const why = tidyReasons(i, today)
    if (why.noDay || why.rate || why.noAmount) {
      tidy.push({ id: i.id, title: i.title, facts: facts(why.noDay && 'no purchase day', why.rate && 'rate pending', why.noAmount && 'sale without an amount') })
      tally.noDay += Number(why.noDay); tally.rate += Number(why.rate); tally.noAmount += Number(why.noAmount)
    }
    if (!isMine(i)) continue

    let claimed = false
    if (i.return_by && i.return_by >= today) {
      const left = daysBetween(today, i.return_by)
      const now = watchedPrice(i, watch)
      if (now && i.price != null && now.currency === currencyOf(i) && now.amount < i.price) {
        claimed = true
        const claim = { currency: now.currency, amount: i.price - now.amount }
        push({ kind: 'cheaper', tone: deadlineTone(left, 'warn'), itemId: i.id, action: 'open', claim, daysLeft: left, signature: `${priceKey(claim)} ${i.return_by}`,
          facts: facts(`${money(claim.amount, claim.currency)} cheaper than you paid`, `return by ${formatDate(i.return_by)}`, whenWords(left)) }, i)
      }
      if (!claimed && left <= RETURN_SOON_DAYS) {
        push({ kind: 'return', tone: deadlineTone(left, 'warn'), itemId: i.id, action: 'open', daysLeft: left, signature: i.return_by,
          facts: facts(`Return by ${formatDate(i.return_by)}`, whenWords(left), paidWords(i)) }, i)
      }
    }
    if (i.warranty_until && i.warranty_until >= today) {
      const left = daysBetween(today, i.warranty_until)
      if (left <= COMPLAINT_SOON_DAYS) {
        push({ kind: 'complaint', tone: deadlineTone(left, 'info'), itemId: i.id, action: 'open', daysLeft: left, signature: i.warranty_until,
          facts: facts(`Can complain until ${formatDate(i.warranty_until)}`, whenWords(left), paidWords(i)) }, i)
      }
    }
    const valueAge = valueAgeDays(i, today)
    if (i.value_now != null && valueAge != null && valueAge > VALUE_STALE_DAYS) {
      push({ kind: 'value', tone: 'info', itemId: i.id, action: 'value', order: -valueAge, signature: `${i.value_on} ${i.value_now}`,
        facts: facts(`Could sell for ${money(i.value_now, i.value_currency ?? 'NOK')}`, `estimated ${formatDate(i.value_on)}`) }, i)
    }
  }

  // The next deal day ahead, once, for the wishes with a target or waiting for a deal.
  const deal = (inputs.deals ?? [])
    .map(d => ({ ...d, left: daysBetween(today, d.day) }))
    .filter(d => d.left >= 0 && d.left <= DEAL_AHEAD_DAYS)
    .sort((a, b) => a.left - b.left || a.name.localeCompare(b.name, 'en'))[0]
  if (deal && watching.length) {
    out.push({
      key: `deal_day:${deal.key}`, kind: 'deal_day', tone: 'info', itemId: null, title: deal.name, action: 'list', claim: null,
      daysLeft: deal.left, order: 0, where: null, signature: `${deal.key} ${deal.day}`, things: watching,
      facts: facts(formatDate(deal.day), whenWords(deal.left), `${plural(watching.length, 'wish', 'wishes')} to watch`),
    })
  }
  if (tidy.length) {
    out.push({
      key: 'tidy', kind: 'tidy', tone: 'info', itemId: null, action: 'list', claim: null, daysLeft: null, order: 0, where: null,
      title: `${plural(tidy.length, 'thing')} to tidy up`, things: tidy,
      signature: tidy.map(t => `${t.id}:${t.facts.join('+')}`).sort().join(','),
      facts: facts(
        tally.noDay > 0 && `${tally.noDay} without a purchase day`,
        tally.rate > 0 && plural(tally.rate, 'rate') + ' pending',
        tally.noAmount > 0 && `${plural(tally.noAmount, 'sale')} without an amount`,
      ),
    })
  }
  return out.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]
    || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity)
    || KIND_RANK[a.kind] - KIND_RANK[b.kind]
    || a.order - b.order
    || a.title.localeCompare(b.title, 'en'))
}

/** The key a row's state is kept under: the thing (or none) and the kind of row. */
export const stateKey = (itemId: string | null, signal: string) => `${itemId ?? '-'}|${signal}`

/**
 * Whether a row shows: not while snoozed (until its day comes), and not after
 * Got it while it says the same (its signature).
 */
export function lookShown(look: Look, state: LookState | undefined, today: string): boolean {
  if (!state) return true
  if (state.until && today < state.until) return false
  return !(state.signature != null && state.signature === look.signature)
}

/** The rows that show, and those snoozed or put away (they can be brought back). */
export function splitLooks(looks: readonly Look[], states: readonly LookState[], today: string): { shown: Look[]; hidden: Look[] } {
  const byKey = new Map(states.map(s => [stateKey(s.item_id, s.signal), s]))
  const shown: Look[] = [], hidden: Look[] = []
  for (const l of looks) (lookShown(l, byKey.get(stateKey(l.itemId, l.kind)), today) ? shown : hidden).push(l)
  return { shown, hidden }
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
