// Buy again (Shop renovation step C): what the quick list's own past ticks
// say is due — a thing bought on three days or more, at a steady rhythm
// ("Milk · Every 6 days · last bought 5 days ago") — and the rest of what was
// bought from it before. Only the owner's own ticks count (a quick-list row
// with status 'bought', on its local day); nothing is guessed from outside.
// Pure — scripts/verify-shop-quick.cjs runs it against fixtures.
import { daysBetween } from './ownModel'
import { boughtDay, buyAgain, fold, listOf, quickOpen, type BuyAgain } from './shopModel'
import type { ShopItem } from './types'

/** Purchase days needed before a rhythm is named: three days give two gaps, one gap is a coincidence. */
export const MIN_DAYS = 3
/** Only the latest gaps count, so the rhythm follows today's habit, not last year's. */
export const RECENT_GAPS = 8
/** Two gaps are a rhythm only when the longer is at most this many times the shorter (stamps 40 / 110 are not). */
export const TWO_GAPS_RATIO = 1.5
/** A rhythm longer than about 8 weeks is a thing bought now and then: Bought before has it, Buy again doesn't nag. */
export const MAX_EVERY = 56
/** Due from 80 % of the usual gap ("every 6 days" is due on day 5). */
export const DUE_AT = 0.8
/** How long past its usual gap a thing is still suggested: one more gap, two weeks at most — then the habit has stopped. */
export const LAPSE_DAYS = 14

/** A thing bought at a steady rhythm and due again. `row` is its latest purchase (what a re-add copies). */
export interface DueAgain extends BuyAgain {
  /** The usual days between two purchases (the median of the recent gaps, at least 1). */
  every: number
  /** Days since the last purchase. */
  since: number
  /** The last purchase day (yyyy-mm-dd, local). */
  last: string
}

/** The middle of the sorted gaps (the mean of the middle two for an even count). */
function median(sorted: readonly number[]): number {
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * A thing's rhythm from its purchase days (yyyy-mm-dd, sorted, one per day):
 * the median of the recent gaps, or null when there are too few days or the
 * gaps don't agree. Two gaps must be close — the longer at most 1.5 × the
 * shorter (5 and 7 is a rhythm; 40 and 110 is not). Three or more need a
 * majority within half the median of it (7, 7, 30 is "every 7 days"; 2, 3,
 * 40, 41 is no rhythm at all).
 */
export function rhythmOf(days: readonly string[]): number | null {
  if (days.length < MIN_DAYS) return null
  const gaps: number[] = []
  for (let i = Math.max(1, days.length - RECENT_GAPS); i < days.length; i++) gaps.push(daysBetween(days[i - 1], days[i]))
  if (gaps.some(g => !(g > 0))) return null
  const sorted = [...gaps].sort((a, b) => a - b)
  if (gaps.length === 2 && sorted[1] > sorted[0] * TWO_GAPS_RATIO) return null
  const m = median(sorted)
  const close = gaps.filter(g => Math.abs(g - m) <= m / 2).length
  return close * 2 > gaps.length ? Math.max(1, Math.round(m)) : null
}

/** The last day a rhythm still suggests a thing: one usual gap past due, two weeks at most. */
export const lapsesAfter = (every: number): number => every + Math.min(every, LAPSE_DAYS)

/** Whether a rhythm says buy again now: from 80 % of the gap until it lapses (`lapsesAfter`); never past 8 weeks' rhythm. */
export function isDue(every: number, since: number): boolean {
  return every <= MAX_EVERY && since >= Math.max(1, Math.round(every * DUE_AT)) && since <= lapsesAfter(every)
}

/** The open quick-list rows' titles (folded) and products (EAN): a thing on the list is never suggested. */
function onTheList(items: readonly ShopItem[]): { titles: Set<string>; eans: Set<string> } {
  const open = quickOpen(items)
  return { titles: new Set(open.map(i => fold(i.title))), eans: new Set(open.map(i => i.ean).filter((e): e is string => !!e)) }
}

/**
 * What the quick list's ticks say is due again on `today` (yyyy-mm-dd, local):
 * things bought on three days or more at a steady rhythm (`rhythmOf`), due
 * by `isDue`, and not on the list now — by name or by product. Two ticks on
 * one day are one purchase. The most overdue first (days since ÷ the usual
 * gap), then the most bought, then A–Z.
 */
export function dueAgain(items: readonly ShopItem[], today: string): DueAgain[] {
  const open = onTheList(items)
  const byThing = new Map<string, { days: Set<string>; latest: ShopItem; at: string }>()
  for (const item of items) {
    if (listOf(item) !== 'quick' || item.status !== 'bought') continue
    const key = fold(item.title)
    const day = boughtDay(item)
    if (!key || !day || day > today) continue
    const at = item.bought_at ?? item.updated_at ?? ''
    const cur = byThing.get(key)
    if (!cur) byThing.set(key, { days: new Set([day]), latest: item, at })
    else {
      cur.days.add(day)
      if (at > cur.at) { cur.latest = item; cur.at = at }
    }
  }
  const out: DueAgain[] = []
  for (const [key, t] of byThing) {
    if (open.titles.has(key) || (t.latest.ean && open.eans.has(t.latest.ean))) continue
    const days = [...t.days].sort()
    const every = rhythmOf(days)
    if (every == null) continue
    const last = days[days.length - 1]
    const since = daysBetween(last, today)
    if (!isDue(every, since)) continue
    out.push({ title: t.latest.title.trim(), count: days.length, row: t.latest, every, since, last })
  }
  return out.sort((a, b) => b.since / b.every - a.since / a.every || b.count - a.count || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' }))
}

/** Bought from the quick list before and not due by a rhythm (`buyAgain`, minus what `due` already suggests). */
export function boughtBefore(items: readonly ShopItem[], due: readonly DueAgain[], limit = 12): BuyAgain[] {
  const shown = new Set(due.map(d => fold(d.title)))
  return buyAgain(items, limit + shown.size).filter(b => !shown.has(fold(b.title))).slice(0, limit)
}

/** "Every day", "Every 6 days", "Every week", "Every 3 weeks". */
function everyWords(days: number): string {
  if (days <= 1) return 'Every day'
  if (days === 7) return 'Every week'
  if (days < 14) return `Every ${days} days`
  return `Every ${Math.round(days / 7)} weeks`
}

/** "yesterday", "17 days ago", "5 weeks ago" — days for the first four weeks, where a day matters. */
function sinceWords(days: number): string {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 28) return `${days} days ago`
  return `${Math.round(days / 7)} weeks ago`
}

/** A suggestion's line, in plain words (cleanup, 11.11.2026): "Every week · last bought 8 days ago". */
export function rhythmWords(d: Pick<DueAgain, 'every' | 'since'>): string {
  return `${everyWords(d.every)} · last bought ${sinceWords(d.since)}`
}
