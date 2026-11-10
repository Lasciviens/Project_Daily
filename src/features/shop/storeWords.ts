// How the Stores screen says a store, a rule and a deal day in words (migration 191's rows). Pure —
// scripts/verify-shop-purchase.cjs.
import { formatDate } from '../../shared/utils/dateFormat'
import { dealRuleOf, nextDeal } from './dealDays'
import type { ShopDealDay, ShopRuleExclusion, ShopStore, ShopStoreKind, ShopStoreRule, ShopStoreRuleKind } from './types'

export const STORE_KIND_LABEL: Record<ShopStoreKind, string> = {
  shop: 'Shop', marketplace: 'Marketplace', price_site: 'Price site', refurbisher: 'Refurbisher',
}

export const RULE_KIND_LABEL: Record<ShopStoreRuleKind, string> = {
  open_purchase: 'Open purchase', return: 'Returns', seasonal_return: 'Seasonal returns', price_match: 'Price match', price_protection: 'Price protection',
}

export const EXCLUSION_LABEL: Record<ShopRuleExclusion, string> = {
  campaign: 'campaign prices', black_friday: 'Black Friday', outlet: 'the outlet', marketplace_seller: 'marketplace sellers', used: 'used things',
}

/** "15.01" from "01-15" (a day of every year, MM-DD). */
export const monthDayWords = (md: string | null): string => (md ? `${md.slice(3)}.${md.slice(0, 2)}` : '')

/** "01-15" from "15.01" (or "15.1"), or null when it isn't a day of every year. */
export function monthDayOf(text: string): string | null {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.?\s*$/.exec(text)
  if (!m) return null
  const d = Number(m[1]), mo = Number(m[2])
  const max = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
  return mo >= 1 && mo <= 12 && d >= 1 && max && d <= max ? `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null
}

/** A rule's facts as short pieces: "50 days", "Kundeklubb members", "bought 15.11–31.12, back by 15.01", "not campaign prices", "gift card". */
export function ruleFacts(rule: ShopStoreRule, stores: readonly ShopStore[]): string[] {
  const out: string[] = []
  if (rule.kind === 'seasonal_return') {
    out.push(`bought ${monthDayWords(rule.window_from)}–${monthDayWords(rule.window_to)}`)
    out.push(rule.return_until ? `back by ${monthDayWords(rule.return_until)}` : `${rule.days} days`)
  } else if (rule.days !== null) out.push(`${rule.days} days`)
  if (rule.kind === 'price_match') {
    const names = (rule.against_stores ?? []).map(id => stores.find(s => s.id === id)?.name).filter((n): n is string => !!n)
    out.push(rule.against === 'any' ? 'against any shop in its country' : names.length ? `against ${names.join(', ')}` : 'against stores not listed any more')
  }
  if (rule.kind === 'price_protection') out.push(rule.against === 'any' ? 'any shop\'s price' : 'its own price')
  if (rule.member_tier) out.push(`${rule.member_tier} members`)
  if (rule.exclusions.length) out.push(`not ${rule.exclusions.map(e => EXCLUSION_LABEL[e]).join(', ')}`)
  if (rule.payout) out.push(rule.payout === 'gift_card' ? 'paid as a gift card' : 'paid as money')
  return out
}

/** A rule's label in its list: its own name, else its kind ("Open purchase"). */
export const ruleTitle = (rule: ShopStoreRule): string => rule.label ?? RULE_KIND_LABEL[rule.kind]

/** Where a rule's facts come from, as a tone and words: the owner's, Ask AI's (check it), or its source's. */
export function ruleOrigin(rule: ShopStoreRule): { tone: 'info' | 'warn' | 'neutral'; words: string } {
  if (rule.owner_edited) return { tone: 'info', words: rule.origin === 'owner' ? 'Yours' : 'You edited it' }
  if (rule.origin === 'ask_ai') return { tone: 'warn', words: 'From Ask AI — check it' }
  return { tone: 'neutral', words: rule.origin === 'page' ? 'From its page' : 'From the store' }
}

/** A link's host as it is shown ("elkjop.no"), or null. */
export function hostWords(url: string | null): string | null {
  if (!url) return null
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null }
}

const ORDINAL = ['', '1st', '2nd', '3rd', '4th']
const WEEKDAY = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/**
 * A deal day's rule in words: "4th Thursday of November, +1 day · 1 day", "11.11 · 5 days" — a month's name is
 * the rule's own (no date is shown with it).
 */
export function dealRuleWords(d: Pick<ShopDealDay, 'rule_kind' | 'month' | 'day' | 'weekday' | 'nth' | 'offset_days' | 'length_days'>): string {
  const when = d.rule_kind === 'fixed'
    ? `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}`
    : `${d.nth === -1 ? 'last' : ORDINAL[d.nth ?? 0] ?? `${d.nth}th`} ${WEEKDAY[d.weekday ?? 0] ?? ''} of ${MONTH[d.month] ?? ''}`
  const offset = d.offset_days ? `, ${d.offset_days > 0 ? '+' : '−'}${Math.abs(d.offset_days)} day${Math.abs(d.offset_days) === 1 ? '' : 's'}` : ''
  return `${when}${offset} · ${d.length_days} day${d.length_days === 1 ? '' : 's'}`
}

/** "Next 27.11.2026", "On now · until 31.12.2026", or null for a rule that gives no day. */
export function dealNextWords(d: ShopDealDay, today: string): string | null {
  const rule = dealRuleOf(d)
  const next = rule ? nextDeal(rule, today) : null
  if (!next) return null
  return next.start <= today ? `On now${next.end > today ? ` · until ${formatDate(next.end)}` : ''}` : `Next ${formatDate(next.start)}`
}
