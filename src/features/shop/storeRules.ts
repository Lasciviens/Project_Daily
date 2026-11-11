// What a store's rules and Norway's law mean for one purchase (migration 191's rows; no store is special, no law
// number lives here — every day count and year comes from a row): which store a link is on, its search link, the
// deadlines (return by, complain by — each date explains itself and says where it comes from), and which store
// matches whose price from a price site's offer list. When unsure (two sources disagree, a fact is unknown) the
// EARLIER date is shown and the law's own last day is named in the words; until Arrived is tapped every count
// starts on the purchase day. Pure — scripts/verify-shop-stores.cjs.
import { formatDate } from '../../shared/utils/dateFormat'
import { wallClockIn } from '../calendar/calendarEventRules'
import { addDays, isDay } from './dealDays'
import { osloDay } from './groceryModel'
import { nextWorkingDay } from './norwayHolidays'
import { addMonths } from './ownModel'
import { hostOn, isSearchPattern, linkHost } from './storeRows'
import type { ShopLawRule, ShopNewOffer, ShopRuleExclusion, ShopStore, ShopStoreRule } from './types'

const ZONE = 'Europe/Oslo'
const NBSP = ' '
/** "2 990": whole units, thousands with a no-break space. */
const num = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
const fold = (s: string): string => s.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
  .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '')
const possessive = (name: string): string => `${name}'s`

// ── Which store ──────────────────────────────────────────────────────────────

/** A link's host in lower case (any web link the owner pasted), or null. */
function hostOfLink(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase().replace(/\.+$/, '') : null
  } catch { return null }
}

/**
 * The store a link is on: its host is one of the store's hosts or a subdomain of one ("m.finn.no" is on FINN's
 * finn.no) — the most specific host wins. Null when no store has it.
 */
export function storeOfLink(url: string, stores: readonly ShopStore[]): ShopStore | null {
  const host = hostOfLink(url)
  if (!host) return null
  let best: { store: ShopStore; length: number } | null = null
  for (const store of stores) {
    for (const h of store.hosts) {
      if ((host === h || host.endsWith(`.${h}`)) && (!best || h.length > best.length)) best = { store, length: h.length }
    }
  }
  return best?.store ?? null
}

/**
 * The site whose terms forbid apps to read a store's pages (188's shop_site_policies, by host — never copied onto
 * the store): the listed host that one of the store's hosts is on, else null.
 */
export function storeSitePolicy(store: ShopStore, policyHosts: readonly string[]): string | null {
  for (const h of store.hosts) {
    const listed = policyHosts.map(p => String(p).trim().toLowerCase()).filter(p => p && (h === p || h.endsWith(`.${p}`)))
    if (listed.length) return listed.sort((a, b) => b.length - a.length)[0]
  }
  return null
}

/**
 * The store whose name a price site shows for an offer: the same letters as its name ("Elkjøp" = "elkjop") or as one
 * of its web addresses ("Proshop.no" = proshop.no), else null.
 */
export function storeOfShopName(name: string, stores: readonly ShopStore[]): ShopStore | null {
  const key = fold(name)
  return key ? stores.find(s => fold(s.name) === key || s.hosts.some(h => fold(h) === key)) ?? null : null
}

/** A watch's new offers (191's new_offers) as offers price match reads, each shop found among the stores by its name. */
export function offersOfWatch(newOffers: readonly ShopNewOffer[] | null | undefined, stores: readonly ShopStore[]): PriceOffer[] {
  return (newOffers ?? []).map(o => ({
    storeId: o.shop_name ? storeOfShopName(o.shop_name, stores)?.id ?? null : null, shop: o.shop_name ?? `Shop ${o.shop_id}`,
    price: o.price, currency: o.currency, condition: 'new' as const, inStock: o.in_stock,
  }))
}

/**
 * The store's search link for a thing (brand + model): its pattern with `{q}` replaced by the URL-encoded words.
 * Null without a pattern or words, or when the result isn't a https link on the store's own host (a last-line
 * guard behind the database's check). Opened by the owner, never fetched.
 */
export function searchLinkFor(store: ShopStore, words: string): string | null {
  const q = words.trim().replace(/\s+/g, ' ')
  if (!q || q.length > 200 || !store.search_url || !isSearchPattern(store.search_url, store.hosts)) return null
  const url = store.search_url.split('{q}').join(encodeURIComponent(q))
  const host = linkHost(url)
  return host !== null && hostOn(host, store.hosts) ? url : null
}

// ── A rule's words ───────────────────────────────────────────────────────────

/** Whether a rule is for everyone or for the tier the owner has at its store (names compared without case). */
export function tierMatches(rule: ShopStoreRule, store: ShopStore): boolean {
  if (!rule.member_tier) return true
  return !!store.member_tier && store.member_tier.trim().toLowerCase() === rule.member_tier.trim().toLowerCase()
}

/** A store's rules that count for the owner: its own, not turned off, for everyone or the owner's tier. */
export function rulesInForce(store: ShopStore, rules: readonly ShopStoreRule[]): ShopStoreRule[] {
  return rules.filter(r => r.store_id === store.id && !r.off && tierMatches(r, store))
}

/**
 * A rule nobody checked on the store's own page, which the owner hasn't edited: Ask AI's (guardian review,
 * 10.11.2026 — its free text is the assistant's) or a price site's words about the store (owner, 11.11.2026: the
 * store's own page can't be read by an app). It is named by its kind, its source comes first, and its date never
 * wins on its own.
 */
export const unchecked = (rule: ShopStoreRule): boolean => (rule.origin === 'ask_ai' || rule.origin === 'price_site') && !rule.owner_edited

/** Who said an unchecked rule: "Ask AI", or the price site by its link's host ("Prisjakt" for prisjakt.no). */
export function claimedBy(rule: Pick<ShopStoreRule, 'origin' | 'source_url'>): string {
  if (rule.origin === 'ask_ai') return 'Ask AI'
  const host = rule.source_url ? linkHost(rule.source_url) : null
  const name = host?.replace(/^www\./, '').split('.')[0] ?? ''
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : 'a price site'
}

/** A rule's name with its source in front when the assistant wrote it: "from Ask AI — check it: Elkjøp's 365-day returns". */
function namedWithSource(rule: ShopStoreRule, store: ShopStore): string {
  return unchecked(rule) ? `${sourceWords(rule)}: ${ruleName(rule, store)}` : `${ruleName(rule, store)}, ${sourceWords(rule)}`
}

/** Where a rule's facts come from: "typed 12.11.2026", "from Ask AI — check it", "read 10.11.2026". */
export function sourceWords(rule: ShopStoreRule): string {
  if (rule.owner_edited) {
    const day = (rule.edited_at && osloDay(rule.edited_at)) || osloDay(rule.created_at)
    return day ? `typed ${formatDate(day)}` : 'typed by you'
  }
  if (rule.origin === 'ask_ai' || rule.origin === 'price_site') return `from ${claimedBy(rule)} — check it`
  return rule.read_on ? `read ${formatDate(rule.read_on)}` : 'not read'
}

/** A rule's name: "Elkjøp's 30-day open purchase", "… for Kundeklubb members", "Elkjøp's Christmas returns". */
export function ruleName(rule: ShopStoreRule, store: ShopStore): string {
  const tier = rule.member_tier && !unchecked(rule) ? ` for ${rule.member_tier} members` : ''
  if (rule.label && !unchecked(rule)) return `${possessive(store.name)} ${rule.label}${tier}`
  switch (rule.kind) {
    case 'open_purchase': return `${possessive(store.name)} ${rule.days}-day open purchase${tier}`
    case 'return': return `${possessive(store.name)} ${rule.days}-day returns${tier}`
    case 'seasonal_return': return `${possessive(store.name)} seasonal returns${tier}`
    case 'price_match': return `${possessive(store.name)} price match${tier}`
    case 'price_protection': return `${possessive(store.name)} ${rule.days}-day price protection${tier}`
  }
}

/**
 * When the owner edited a rule and its source now says something else: "Its source now says 45 days (read
 * 10.11.2026)" — a conflict shown, never picked. Null otherwise.
 */
export function sourceConflict(rule: ShopStoreRule): string | null {
  const s = rule.source
  if (!rule.owner_edited || !s) return null
  const said = s.kind === 'seasonal_return' && s.return_until ? `until ${s.return_until.slice(3)}.${s.return_until.slice(0, 2)}`
    : s.days !== null ? `${s.days} days` : null
  const now = rule.kind === 'seasonal_return' && rule.return_until ? `until ${rule.return_until.slice(3)}.${rule.return_until.slice(0, 2)}`
    : rule.days !== null ? `${rule.days} days` : null
  if (!said || said === now) return null
  return `Its source says ${said}${s.read_on ? ` (read ${formatDate(s.read_on)})` : ''}`
}

// ── Deadlines ────────────────────────────────────────────────────────────────

/** What is known about one purchase. Missing = not known (the earlier date then stands in). */
export interface PurchaseFacts {
  /** yyyy-mm-dd, Oslo. */
  boughtOn:     string
  /** The day Arrived was tapped; null = not yet, so counts start on the purchase day. */
  arrivedOn?:   string | null
  channel?:     'online' | 'in_store' | null
  seller?:      'business' | 'private' | null
  /** Meant to last considerably longer in normal use (the 5-year complaint right). */
  longLasting?: boolean | null
  /** Was it a campaign price, Black Friday, outlet, a marketplace seller, used: true / false; missing = not known. */
  conditions?:  Partial<Record<ShopRuleExclusion, boolean>>
}

export interface Deadline {
  /** yyyy-mm-dd: the date shown (the earlier one when unsure). */
  day:          string
  /** "Return by 15.01.2027 — Elkjøp's Christmas returns, typed 10.11.2026". */
  words:        string
  /** The law's own last day when it is later than the date shown (moved past a weekend or holiday). */
  legalLastDay: string | null
  /** Counted from the purchase day (Arrived not tapped) or from arrival. */
  from:         'purchase' | 'arrival'
  /** The store rules behind the date. */
  ruleIds:      string[]
  /** The law rule behind the date. */
  lawSlug:      string | null
  /** Two sources disagree, or a fact is unknown: the earlier date stands in. */
  unsure:       boolean
}

export interface PurchaseDeadlines {
  returnBy:    Deadline | null
  complaintBy: Deadline | null
  /** What else may hold, and why not counted ("Elkjøp's Christmas returns may give until … — if …"). */
  notes:       string[]
}

const RETURN_KINDS = new Set(['open_purchase', 'return', 'seasonal_return'])
const EXCLUSION_WORDS: Record<ShopRuleExclusion, string> = {
  campaign: 'it wasn\'t a campaign price', black_friday: 'it wasn\'t bought on Black Friday', outlet: 'it wasn\'t from the outlet',
  marketplace_seller: 'it wasn\'t sold by a marketplace seller', used: 'it wasn\'t used',
}

/** Whether a rule holds for this purchase: its exclusions against what is known — yes, no, or maybe (not known). */
function holds(rule: ShopStoreRule, p: PurchaseFacts): { holds: 'yes' | 'no' | 'maybe'; unknown: ShopRuleExclusion[] } {
  const unknown: ShopRuleExclusion[] = []
  for (const e of rule.exclusions) {
    const v = p.conditions?.[e]
    if (v === true) return { holds: 'no', unknown: [] }
    if (v !== false) unknown.push(e)
  }
  return { holds: unknown.length ? 'maybe' : 'yes', unknown }
}

/** A seasonal rule's window around the purchase day ([start, end], yyyy-mm-dd), or null when bought outside it. */
function seasonOf(rule: ShopStoreRule, bought: string): { start: string; end: string } | null {
  if (!rule.window_from || !rule.window_to) return null
  const y = Number(bought.slice(0, 4))
  const md = bought.slice(5)
  const at = (year: number, monthDay: string) => `${year}-${monthDay}`
  if (rule.window_from <= rule.window_to) {
    return md >= rule.window_from && md <= rule.window_to ? { start: at(y, rule.window_from), end: at(y, rule.window_to) } : null
  }
  if (md >= rule.window_from) return { start: at(y, rule.window_from), end: at(y + 1, rule.window_to) }
  if (md <= rule.window_to) return { start: at(y - 1, rule.window_from), end: at(y, rule.window_to) }
  return null
}

/** The last day a store rule gives this purchase, or null when it doesn't hold (bought outside its window). */
function ruleDay(rule: ShopStoreRule, p: PurchaseFacts, start: string): string | null {
  if (rule.kind !== 'seasonal_return') return rule.days !== null ? addDays(start, rule.days) : null
  const season = seasonOf(rule, p.boughtOn)
  if (!season) return null
  if (rule.days !== null) return addDays(start, rule.days)
  if (!rule.return_until) return null
  // The first return-until day on or after the window's end.
  const y = Number(season.end.slice(0, 4))
  const sameYear = `${y}-${rule.return_until}`
  return sameYear >= season.end ? sameYear : `${y + 1}-${rule.return_until}`
}

/** A law rule for this seller and channel (kind cancel or complaint); `channel` null = not known. */
function lawFor(law: readonly ShopLawRule[], kind: ShopLawRule['kind'], seller: 'business' | 'private', channel: 'distance' | 'in_store' | null): ShopLawRule[] {
  return law.filter(l => l.country === 'NO' && l.kind === kind && l.seller === seller && (channel === null || l.channel === 'any' || l.channel === channel))
}

interface Candidate {
  day: string
  /** Short: "Elkjøp's 30-day open purchase", "the right to cancel (angrerett)". */
  name: string
  /** With its source: "Elkjøp's 30-day open purchase, read 10.11.2026". */
  words: string
  ruleIds: string[]
  lawSlug: string | null
  unsure: boolean
  legalLastDay: string | null
  /** Its date is counted from the start (the purchase day until Arrived). */
  fromStart: boolean
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1)
/** "the right to cancel (angrerett)" from a law rule's name, its "…, 5 years" left out. */
const lawName = (l: ShopLawRule): string => `the ${lowerFirst(l.name.replace(/, \d+ years$/, ''))}`

/** The right to cancel for this purchase: a date, a "no right" note, or a "may" note when the channel or seller is unknown. */
function cancelRight(p: PurchaseFacts, law: readonly ShopLawRule[], start: string, notes: string[]): Candidate | null {
  const channel = p.channel === 'online' ? 'distance' : p.channel === 'in_store' ? 'in_store' : null
  const rows = lawFor(law, 'cancel', p.seller ?? 'business', channel)
  const right = rows.find(r => r.gives_right && r.days !== null)
  if (!right || right.days === null) {
    const none = rows.find(r => !r.gives_right)
    if (none && (p.seller || channel === 'in_store')) notes.push(`${none.name} — ${none.law}`)
    return null
  }
  const day = addDays(start, right.days)
  if (channel === null || !p.seller) {
    notes.push(`If it was bought online from a business: ${lawName(right)} to ${formatDate(day)} — ${right.law}`)
    return null
  }
  // The law counts from receipt and a last day on a weekend or holiday moves on: the earlier day is shown, the law's named.
  const legal = p.arrivedOn && right.to_workday ? nextWorkingDay(day) : null
  return {
    day, name: lawName(right), words: `${lawName(right)}, ${right.days} days, ${right.law}`, ruleIds: [], lawSlug: right.slug,
    unsure: false, legalLastDay: legal && legal > day ? legal : null, fromStart: true,
  }
}

/** The store's return rules for this purchase: the dates that hold, a conflict's earlier date, the maybes as notes. */
function storeReturns(store: ShopStore, rules: readonly ShopStoreRule[], p: PurchaseFacts, start: string, notes: string[]): Candidate[] {
  const groups = new Map<string, { rule: ShopStoreRule; day: string }[]>()
  for (const rule of rulesInForce(store, rules)) {
    if (!RETURN_KINDS.has(rule.kind)) continue
    const day = ruleDay(rule, p, start)
    if (!day) continue
    const h = holds(rule, p)
    if (h.holds === 'no') continue
    if (unchecked(rule)) {
      notes.push(`${namedWithSource(rule, store)} — until ${formatDate(day)}, not counted until you check it`)
      continue
    }
    if (h.holds === 'maybe') {
      notes.push(`${ruleName(rule, store)} may give until ${formatDate(day)} — if ${h.unknown.map(e => EXCLUSION_WORDS[e]).join(' and ')} (${sourceWords(rule)})`)
      continue
    }
    // Rules of one kind, tier and window are one claim: two sources saying different days are a conflict.
    const key = [rule.kind, (rule.member_tier ?? '').toLowerCase(), rule.window_from ?? '', rule.window_to ?? ''].join('|')
    groups.set(key, [...(groups.get(key) ?? []), { rule, day }])
  }
  const out: Candidate[] = []
  for (const group of groups.values()) {
    group.sort((a, b) => a.day.localeCompare(b.day) || a.rule.id.localeCompare(b.rule.id))
    const first = group[0]
    const conflict = new Set(group.map(g => g.day)).size > 1
    const words = conflict
      ? `${store.name} says ${group.map(g => `${g.rule.days !== null ? `${g.rule.days} days` : `until ${formatDate(g.day)}`} (${sourceWords(g.rule)})`).join(' and ')} — the earlier date is shown`
      : namedWithSource(first.rule, store)
    out.push({ day: first.day, name: ruleName(first.rule, store), words, ruleIds: group.map(g => g.rule.id), lawSlug: null, unsure: conflict, legalLastDay: null, fromStart: first.rule.kind !== 'seasonal_return' || first.rule.days !== null })
  }
  return out
}

/**
 * Return by and complain by for one purchase at `store` (null = no store row: the law only), from its rules and
 * Norway's law. Each date explains itself. Until Arrived is tapped every count starts on the purchase day (the
 * earlier date); two sources that disagree give the earlier date; a rule whose exclusions aren't known isn't
 * counted (it is named in `notes`).
 */
export function purchaseDeadlines(
  p: PurchaseFacts,
  ctx: { store: ShopStore | null; rules: readonly ShopStoreRule[]; law: readonly ShopLawRule[] },
): PurchaseDeadlines {
  const notes: string[] = []
  if (!isDay(p.boughtOn)) return { returnBy: null, complaintBy: null, notes }
  const arrived = p.arrivedOn && isDay(p.arrivedOn) && p.arrivedOn >= p.boughtOn ? p.arrivedOn : null
  const start = arrived ?? p.boughtOn
  const from: Deadline['from'] = arrived ? 'arrival' : 'purchase'
  const fromWords = arrived ? '' : '; counted from the purchase day until you tap Arrived'

  // Return by: the latest date a right that surely holds gives (a store's rule, the right to cancel).
  const candidates = [
    ...(ctx.store ? storeReturns(ctx.store, ctx.rules, p, start, notes) : []),
    ...[cancelRight(p, ctx.law, start, notes)].filter((c): c is Candidate => c !== null),
  ].sort((a, b) => b.day.localeCompare(a.day))
  let returnBy: Deadline | null = null
  if (candidates.length) {
    const [best, ...rest] = candidates
    const also = rest.map(c => `; ${c.name} runs to ${formatDate(c.day)}`).join('')
    const law = candidates.find(c => c.legalLastDay)
    const legal = law?.legalLastDay ?? null
    const legalWords = law && legal ? `; by law to ${formatDate(legal)} (${formatDate(law.day)} is not a working day)` : ''
    returnBy = {
      day: best.day,
      words: `Return by ${formatDate(best.day)} — ${best.words}${also}${legalWords}${candidates.some(c => c.fromStart) ? fromWords : ''}`,
      legalLastDay: legal && legal > best.day ? legal : null, from,
      ruleIds: candidates.flatMap(c => c.ruleIds), lawSlug: candidates.find(c => c.lawSlug)?.lawSlug ?? null,
      // A rule Ask AI wrote and nobody checked may say more: the date shown is the earlier one, and unsure.
      unsure: candidates.some(c => c.unsure) || (ctx.store ? rulesInForce(ctx.store, ctx.rules).some(r => RETURN_KINDS.has(r.kind) && unchecked(r)) : false),
    }
  }

  // Complain by: the law's years for this seller; when the seller or the thing's life isn't known, the shorter —
  // the longer ones named in the words.
  let complaintBy: Deadline | null = null
  const sellers: ('business' | 'private')[] = p.seller ? [p.seller] : ['business', 'private']
  const possible = sellers.flatMap(s => lawFor(ctx.law, 'complaint', s, null))
    .filter(r => r.years !== null && (p.longLasting == null || r.long_lasting === null || r.long_lasting === p.longLasting))
  const pick = possible.filter(r => p.longLasting != null || r.long_lasting !== true)
    .sort((a, b) => (a.years as number) - (b.years as number) || a.slug.localeCompare(b.slug))[0]
  if (pick && pick.years !== null) {
    const day = addMonths(start, pick.years * 12)
    const longer = [...new Map(possible.filter(r => (r.years as number) > (pick.years as number))
      .map(r => [r.years, `${r.years} years${r.long_lasting === true && p.longLasting == null ? ' if it is meant to last much longer' : ''}${!p.seller ? ` from a ${r.seller === 'business' ? 'business' : 'private seller'}` : ''}`])).values()]
    complaintBy = {
      day,
      words: `Complain by ${formatDate(day)} — ${lawName(pick)}, ${pick.years} years, ${pick.law}${longer.map(w => `; ${w}`).join('')}${fromWords}`,
      legalLastDay: null, from, ruleIds: [], lawSlug: pick.slug, unsure: longer.length > 0,
    }
  }
  return { returnBy, complaintBy, notes }
}

// ── Price match ──────────────────────────────────────────────────────────────

/** One offer on a price site's list (Prisjakt's offer rows), its shop resolved to a store row when there is one. */
export interface PriceOffer {
  /** The store row the offer is from (storeOfShopName), null = a shop with no row. */
  storeId:            string | null
  /** The shop's name as the price site shows it. */
  shop:               string
  price:              number
  currency:           string
  condition:          'new' | 'used' | 'refurbished'
  inStock:            boolean | null
  marketplaceSeller?: boolean
}

export interface PriceMatch {
  /** The store that matches … */
  store:    ShopStore
  rule:     ShopStoreRule
  /** … this offer, at its price. */
  offer:    PriceOffer
  matches:  string
  price:    number
  currency: string
  /** The store's own new price on the same list, when it has one, and what the match saves on it. */
  ownPrice: number | null
  saves:    number | null
  /** "Elkjøp matches Power: 2 990 there, read 05:23 — its price match, typed 10.11.2026". */
  words:    string
  /** The store's price-match rule is one Ask AI wrote and nobody checked. */
  unsure:   boolean
  /** What the store's terms leave out that the list can't tell ("Elkjøp doesn't match campaign prices — check Power's isn't one"). */
  caveats:  string[]
}

const CAVEAT: Partial<Record<ShopRuleExclusion, string>> = { campaign: 'campaign prices', black_friday: 'Black Friday prices', outlet: 'outlet prices' }

/** "05:23" when read today (Oslo), else "09.11.2026". */
function readWords(readAt: string, now: string): string {
  const at = wallClockIn(readAt, ZONE), today = wallClockIn(now, ZONE)
  if (!at) return 'at an unknown time'
  return today && at.date === today.date ? at.time.slice(0, 5) : formatDate(at.date)
}

/**
 * Which store matches whom, from one offer list read at `readAt`: for each store (not hidden) with a price match
 * that counts for the owner, the cheapest new offer in stock (or stock unknown) in its own currency from a store
 * it matches — `listed` ones, or `any` shop in its country (a shop with no row too, a marketplace never) — and
 * only when that is cheaper than its own price on the list. Best saving first.
 */
export function priceMatches(stores: readonly ShopStore[], rules: readonly ShopStoreRule[], offers: readonly PriceOffer[], readAt: string, now: string): PriceMatch[] {
  const byId = new Map(stores.map(s => [s.id, s]))
  const clean = offers.filter(o => o.condition === 'new' && typeof o.price === 'number' && Number.isFinite(o.price) && o.price > 0
    && o.inStock !== false && /^[A-Z]{3}$/.test(o.currency))
  const out: PriceMatch[] = []
  for (const store of stores) {
    if (store.hidden || store.kind !== 'shop') continue
    const own = clean.filter(o => o.storeId === store.id && o.currency === store.currency).reduce<number | null>((m, o) => (m === null || o.price < m ? o.price : m), null)
    let best: { rule: ShopStoreRule; offer: PriceOffer; name: string } | null = null
    for (const rule of rulesInForce(store, rules)) {
      if (rule.kind !== 'price_match') continue
      for (const offer of clean) {
        if (offer.currency !== store.currency || offer.storeId === store.id) continue
        const other = offer.storeId ? byId.get(offer.storeId) ?? null : null
        if (offer.storeId && !other) continue
        if (other && (other.kind !== 'shop' && other.kind !== 'refurbisher')) continue
        if ((offer.marketplaceSeller || other?.kind === 'marketplace') && rule.exclusions.includes('marketplace_seller')) continue
        if (rule.against === 'listed' ? !offer.storeId || !(rule.against_stores ?? []).includes(offer.storeId)
          : !(other === null || other.country === store.country)) continue
        if (!best || offer.price < best.offer.price || (offer.price === best.offer.price && (other?.name ?? offer.shop) < best.name)) {
          best = { rule, offer, name: other?.name ?? offer.shop }
        }
      }
    }
    if (!best || (own !== null && best.offer.price >= own)) continue
    const caveats = [
      ...(unchecked(best.rule) ? [`${possessive(store.name)} price match is from ${claimedBy(best.rule)} — check it before you ask at the till`] : []),
      ...best.rule.exclusions.filter(e => CAVEAT[e]).map(e => `${store.name} doesn't match ${CAVEAT[e]} — check ${possessive(best!.name)} isn't one`),
    ]
    out.push({
      store, rule: best.rule, offer: best.offer, matches: best.name, price: best.offer.price, currency: best.offer.currency,
      ownPrice: own, saves: own !== null ? own - best.offer.price : null,
      words: `${store.name} matches ${best.name}: ${num(best.offer.price)} there, read ${readWords(readAt, now)} — its price match, ${sourceWords(best.rule)}`,
      caveats, unsure: unchecked(best.rule),
    })
  }
  return out.sort((a, b) => (b.saves ?? -1) - (a.saves ?? -1) || a.price - b.price || a.store.name.localeCompare(b.store.name, 'en'))
}
