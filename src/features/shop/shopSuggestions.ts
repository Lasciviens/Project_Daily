// "Needs a look": what in the Shop wants doing now and the money at stake,
// from the data already there — the rows, their price watch and clean price
// figures (shop_price_stats), and the deal days ahead (shop_deal_days). Each
// row can be snoozed for a week or put away with Got it: it comes back only
// when what it says changes (its signature, signalStates.signalSignature).
// Pure — scripts/verify-shop-suggestions.cjs.
import { formatDate } from '../../shared/utils/dateFormat'
import { formatMoney } from '../settings/subscriptionRules'
import { addDays, daysBetween, isMine, isPossession, PAID_BACK, valueAgeDays, VALUE_STALE_DAYS } from './ownModel'
import { currencyOf, listOf, localDay, type Money } from './shopModel'
import { isSignalHidden, signalSignature, signalStateKey, signalStateMap } from './signalStates'
import { atTarget, backInStock, BELT, cleanPrice, fakeBefore, lowestIn60, readPrice, type PriceFacts } from './wishTile'
import { mixedWords } from './watchWords'
import type { DealAhead } from './dealDays'
import type { ShopItem, ShopPriceWatch, ShopSignal, ShopSignalState } from './types'

/** A row's kind is its signal (migration 190's allow-list): what Snooze and Got it are kept under. */
export type LookKind = ShopSignal
/** Danger: due today or tomorrow · warn: money to claim, ≤ 3 days, a "before" price never seen · success: good news · info: dates further out and tidy-up. */
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
  /** What a row about no thing is about: a deal day's slug (each deal day snoozed on its own); null otherwise. */
  subject: string | null
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
  /** What the row says, in short (signalSignature): after Got it it shows again only when this changes. */
  signature: string
  /** What a 'list' row opens. */
  things: LookThing[]
  /** The day Snooze hides it until (snoozeUntil): a week, or the day before its deadline when that is sooner; null when it can't (due tomorrow). */
  snoozeTo: string | null
}

/** About six months, as Owned's "update it" on an old "Could sell for". */
export const WISH_OLD_DAYS = VALUE_STALE_DAYS
export const RETURN_SOON_DAYS = 3
/** A return window shows from two weeks ahead (info), warns from three days, and is danger today or tomorrow. */
export const RETURN_AHEAD_DAYS = 14
export const COMPLAINT_SOON_DAYS = 60
/** Norges Bank publishes after 16:00 on weekdays, and the page fetches what waits: a rate still missing after three days needs a hand. */
export const RATE_GRACE_DAYS = 3
/** A deal day shows from three weeks ahead (dealDays.dealsAhead's `withinDays`). */
export const DEAL_AHEAD_DAYS = 21
/** Snooze hides a row for a week — or until the day before its deadline, when that comes first. */
export const SNOOZE_DAYS = 7

const TONE_RANK: Record<LookTone, number> = { danger: 0, warn: 1, success: 2, info: 3 }
const KIND_RANK: Record<LookKind, number> = {
  return_closing: 0, cheaper_returnable: 1, at_target: 2, lowest_seen: 3, back_in_stock: 4, fake_before: 5, deal_day: 6,
  complaint_ending: 7, old_value: 8, old_wish: 9, tidy_up: 10,
}

const money = (n: number, currency: string) => formatMoney(Math.round(n), currency)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** A space a line never breaks at. */
const NBSP = String.fromCharCode(160)

/** "today", "tomorrow", "in 5 days". */
export function whenWords(daysLeft: number): string {
  return daysLeft <= 0 ? 'today' : daysLeft === 1 ? 'tomorrow' : `in ${daysLeft} days`
}

/**
 * The day a snooze from `today` ends (the row comes back that day): a week on, or the day before its deadline
 * (`daysLeft` from today) when that is sooner — a snooze never hides a deadline past its day. Null when that
 * day is today: a row due tomorrow can't be snoozed.
 */
export function snoozeUntil(today: string, daysLeft: number | null = null): string | null {
  const days = daysLeft == null ? SNOOZE_DAYS : Math.min(SNOOZE_DAYS, daysLeft - 1)
  return days >= 1 ? addDays(today, days) : null
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
/** "read 08.11.2026" when the price a row shows wasn't read today — an old price never looks current. */
function readWords(watch: ShopPriceWatch | null | undefined, today: string): string | null {
  const at = watch ? watch.last_ok_at ?? watch.checked_at : null
  const day = at ? localDay(at) : null
  return day && day !== today ? `read ${formatDate(day)}` : null
}
const foreign = (c: string | null | undefined) => !!c && c.toUpperCase() !== 'NOK'
const facts = (...xs: (string | null | false | undefined)[]): string[] => xs.filter((x): x is string => !!x)

/** A wish's price for its row: its own (a general wish's range), never a guess. */
function wishPrice(i: ShopItem, watch: ShopPriceWatch | null | undefined): string | null {
  const now = readPrice(i, watch)
  // A Prisjakt figure that may be a used one says so, as on every screen (", new and used").
  if (now) return `${money(now.amount, now.currency)}${watch ? mixedWords(watch) : ''}`
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

/** The inputs beside the rows: their last price reads, clean price figures, and the deal days ahead (dealsAhead). */
export interface LookInputs {
  watches: ReadonlyMap<string, ShopPriceWatch>
  facts?: ReadonlyMap<string, PriceFacts>
  deals?: readonly DealAhead[]
}

type Draft = Omit<Look, 'key' | 'title' | 'claim' | 'daysLeft' | 'order' | 'where' | 'things' | 'signature' | 'subject' | 'snoozeTo'>
  & Partial<Pick<Look, 'claim' | 'daysLeft' | 'order' | 'where' | 'things'>>
  & { sign: (string | number | null | undefined)[] }

/**
 * Everything that needs a look, most urgent first: a return window closing
 * (two weeks ahead), a price under what you paid while you can still return
 * it, a wish at its target, at its 60-day low or restocked, a "before" price
 * the link never showed, each deal day ahead for the wishes with a target
 * (splitLooks shows the next one not snoozed), a complaint right ending, an
 * old "Could sell for", a wish waiting half a year, and one row listing what
 * to tidy up.
 */
export function needsALook(items: readonly ShopItem[], inputs: LookInputs, today: string): Look[] {
  const out: Look[] = []
  const tidy: LookThing[] = []
  const tally = { noDay: 0, rate: 0, noAmount: 0 }
  const watching: LookThing[] = []
  const push = ({ sign, ...l }: Draft, i: ShopItem) => out.push({
    key: `${l.kind}:${i.id}`, title: i.title, claim: null, daysLeft: null, order: 0, where: null, things: [], subject: null,
    signature: signalSignature(l.kind, ...sign), snoozeTo: snoozeUntil(today, l.daysLeft ?? null), ...l,
  })

  for (const i of items) {
    const watch = inputs.watches.get(i.id)
    if (listOf(i) === 'wishlist' && i.status === 'wishlist') {
      // A general wish's models are counted through the wish.
      if (i.option_for) continue
      if (i.kind !== 'general') {
        const f = inputs.facts?.get(i.id) ?? null
        const now = cleanPrice(i, watch)
        const where = atSite(i, watch)
        const read = readWords(watch, today)
        // One buy signal a wish: the first that holds — in the tile's belt's words (wishTile.BELT).
        if (now && atTarget(i, watch)) {
          push({ kind: 'at_target', tone: 'success', itemId: i.id, action: 'bought', where, sign: [now.currency, now.amount],
            facts: facts('At your target', read, money(now.amount, now.currency)) }, i)
        } else if (now && f && lowestIn60(now, f)) {
          push({ kind: 'lowest_seen', tone: 'success', itemId: i.id, action: 'bought', where, sign: [f.currency, f.low60],
            facts: facts(BELT.lowest.label, read, money(now.amount, now.currency)) }, i)
        } else if (now && f && backInStock(i, watch, f)) {
          push({ kind: 'back_in_stock', tone: 'success', itemId: i.id, action: 'bought', where, sign: [f.restockedAt],
            facts: facts(BELT.back.label, read, money(now.amount, now.currency)) }, i)
        }
        if (now && watch?.was != null && f?.since60 && fakeBefore(i, watch, f, today)) {
          push({ kind: 'fake_before', tone: 'warn', itemId: i.id, action: 'open', where, sign: [now.currency, watch.was],
            facts: facts(`"Before" ${money(watch.was, now.currency)}`, `not seen since ${formatDate(f.since60)}`, read, `now ${money(now.amount, now.currency)}`) }, i)
        }
        if (i.target_price != null || i.wait_for_deal) {
          const price = wishPrice(i, watch)
          watching.push({ id: i.id, title: i.title, facts: facts(
            price ? `now ${price}` : 'no price yet',
            i.target_price != null && `target ${money(i.target_price, currencyOf(i))}`,
            i.wait_for_deal && i.target_price == null && 'waiting for a deal',
          ) })
        }
      }
      const created = localDay(i.created_at)
      const age = daysBetween(created, today)
      if (age > WISH_OLD_DAYS) {
        // Signed by its first day only: a price that moves doesn't bring a wish put away back.
        push({ kind: 'old_wish', tone: 'info', itemId: i.id, action: 'open', order: -age, sign: [created],
          facts: facts(`On the wishlist since ${formatDate(created)}`, wishPrice(i, watch)) }, i)
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
      // Money to claim only from a price read just now and clean — a new offer's or the shop's own, never a
      // figure that may be a used one (mixed, or read before 188) nor a price kept from an older read.
      const now = watch?.status === 'ok' ? cleanPrice(i, watch) : null
      if (now && i.price != null && now.currency === currencyOf(i) && now.amount < i.price) {
        claimed = true
        const claim = { currency: now.currency, amount: i.price - now.amount }
        push({ kind: 'cheaper_returnable', tone: deadlineTone(left, 'warn'), itemId: i.id, action: 'open', claim, daysLeft: left,
          sign: [claim.currency, claim.amount, i.return_by],
          facts: facts(`${money(claim.amount, claim.currency)} cheaper than you paid`, readWords(watch, today), `return by ${formatDate(i.return_by)}`, whenWords(left)) }, i)
      }
      if (!claimed && left <= RETURN_AHEAD_DAYS) {
        push({ kind: 'return_closing', tone: deadlineTone(left, 'info'), itemId: i.id, action: 'open', daysLeft: left, sign: [i.return_by],
          facts: facts(`Return by ${formatDate(i.return_by)}`, whenWords(left), paidWords(i)) }, i)
      }
    }
    if (i.warranty_until && i.warranty_until >= today) {
      const left = daysBetween(today, i.warranty_until)
      if (left <= COMPLAINT_SOON_DAYS) {
        push({ kind: 'complaint_ending', tone: deadlineTone(left, 'info'), itemId: i.id, action: 'open', daysLeft: left, sign: [i.warranty_until],
          facts: facts(`Can complain until ${formatDate(i.warranty_until)}`, whenWords(left), paidWords(i)) }, i)
      }
    }
    const valueAge = valueAgeDays(i, today)
    if (i.value_now != null && valueAge != null && valueAge > VALUE_STALE_DAYS) {
      push({ kind: 'old_value', tone: 'info', itemId: i.id, action: 'value', order: -valueAge, sign: [i.value_on],
        facts: facts(`Could sell for ${money(i.value_now, i.value_currency ?? 'NOK')}`, `estimated ${formatDate(i.value_on)}`) }, i)
    }
  }

  // Each deal day ahead, for the wishes with a target or waiting for a deal — keyed by its slug, so snoozing one
  // never hides another; splitLooks shows the next one that isn't snoozed or put away.
  for (const deal of (inputs.deals ?? []).filter(d => d.daysUntil <= DEAL_AHEAD_DAYS)) {
    if (!watching.length) break
    out.push({
      key: `deal_day:${deal.deal.slug}`, kind: 'deal_day', tone: 'info', itemId: null, subject: deal.deal.slug, title: deal.deal.name, action: 'list', claim: null,
      daysLeft: deal.daysUntil, order: 0, where: null, signature: signalSignature('deal_day', deal.deal.slug, deal.start), things: watching,
      snoozeTo: snoozeUntil(today, deal.running ? null : deal.daysUntil),
      facts: facts(
        deal.running ? 'On now' : formatDate(deal.start),
        deal.running ? (deal.end > deal.start ? `until ${formatDate(deal.end)}` : null) : whenWords(deal.daysUntil),
        `${plural(watching.length, 'wish', 'wishes')} to watch`,
      ),
    })
  }
  if (tidy.length) {
    out.push({
      key: 'tidy_up', kind: 'tidy_up', tone: 'info', itemId: null, subject: null, action: 'list', claim: null, daysLeft: null, order: 0, where: null,
      snoozeTo: snoozeUntil(today),
      title: `${plural(tidy.length, 'thing')} to tidy up`, things: tidy,
      signature: signalSignature('tidy_up', ...tidy.map(t => `${t.id}:${t.facts.join('+')}`).sort()),
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

/**
 * The rows that show, and those snoozed or put away (Show again brings them
 * back): a row stays away while snoozed until a later day, or while Got it
 * was said to what it says now (signalStates.isSignalHidden). Of the deal
 * days ahead only the next one that isn't hidden shows.
 */
export function splitLooks(looks: readonly Look[], states: readonly ShopSignalState[], today: string): { shown: Look[]; hidden: Look[] } {
  const byKey = signalStateMap(states)
  const shown: Look[] = [], hidden: Look[] = []
  let deal = false
  for (const l of looks) {
    if (isSignalHidden(byKey.get(signalStateKey(l.itemId, l.kind, l.subject)), l.signature, today)) hidden.push(l)
    else if (l.kind !== 'deal_day' || !deal) { shown.push(l); deal ||= l.kind === 'deal_day' }
  }
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
