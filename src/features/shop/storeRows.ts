// Stores, their rules, Norway's law and the owner's deal-day edits as rows (migration 191): each row read back from
// the database is checked where it enters (191's CHECKs, the same limits), what the owner types is checked before it
// is sent, and the deal days the app counts are 190's rows with the owner's own versions laid over them. Pure —
// scripts/verify-shop-stores.cjs.
import { dealRuleOf, isDay, parseDealDay } from './dealDays'
import { osloDay } from './groceryModel'
import type {
  ShopDealDay, ShopDealDayEdit, ShopDealDayRow, ShopLawRule, ShopRuleAgainst, ShopRuleExclusion, ShopRuleOrigin,
  ShopRulePayout, ShopStore, ShopStoreFacts, ShopStoreKind, ShopStoreRule, ShopStoreRuleFacts, ShopStoreRuleKind,
} from './types'

/** 191's allow-lists, each once (a missing or unknown key is a type error here). */
const STORE_KIND: Record<ShopStoreKind, true> = { shop: true, marketplace: true, price_site: true, refurbisher: true }
const RULE_KIND: Record<ShopStoreRuleKind, true> = { open_purchase: true, return: true, seasonal_return: true, price_match: true, price_protection: true }
const EXCLUSION: Record<ShopRuleExclusion, true> = { campaign: true, black_friday: true, outlet: true, marketplace_seller: true, used: true }
const ORIGIN: Record<ShopRuleOrigin, true> = { seed: true, page: true, owner: true, ask_ai: true }
const PAYOUT: Record<ShopRulePayout, true> = { money: true, gift_card: true }
const AGAINST: Record<ShopRuleAgainst, true> = { listed: true, any: true, own: true }

export const STORE_KINDS = Object.keys(STORE_KIND) as ShopStoreKind[]
export const RULE_KINDS = Object.keys(RULE_KIND) as ShopStoreRuleKind[]
export const RULE_EXCLUSIONS = Object.keys(EXCLUSION) as ShopRuleExclusion[]

const has = <K extends string>(o: Record<K, true>, x: unknown): x is K => typeof x === 'string' && Object.prototype.hasOwnProperty.call(o, x)

/** 191's shop_host_ok: lower case, dotted labels, no scheme, port or path, ≤ 253. */
export const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
/** 191's shop_https_ok: https, a host right after the scheme (no user, no port), no space, quote or bracket; ≤ 2 048. */
export const HTTPS_RE = /^https:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+([/?#][^\s"<>`\\]*)?$/
/** A day of the year (MM-DD) that every year has — no 29.02 (191's shop_month_day_ok). */
export const MONTH_DAY_RE = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SEED_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/

export const isHost = (h: unknown): h is string => typeof h === 'string' && h.length <= 253 && HOST_RE.test(h)
/** A link the app may show and open: 191's https check (control characters refused too). */
export const isShownLink = (u: unknown): u is string =>
  typeof u === 'string' && u.length <= 2048 && ![...u].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && HTTPS_RE.test(u)
export function isMonthDay(x: unknown): x is string {
  return typeof x === 'string' && MONTH_DAY_RE.test(x) && Number(x.slice(3)) <= MONTH_DAYS[Number(x.slice(0, 2)) - 1]
}

/** The lower-case host of a link the app may show, else null. */
export function linkHost(url: string): string | null {
  if (!isShownLink(url)) return null
  return url.slice('https://'.length).split(/[/?#]/)[0].toLowerCase()
}

/** Whether `host` is one of `hosts` or a subdomain of one (188's and 191's rule). */
export function hostOn(host: string, hosts: readonly string[]): boolean {
  return hosts.some(h => host === h || host.endsWith(`.${h}`))
}

/** 191's search-link check: `{q}` at least once, never in the host; filled in, a link on one of the store's hosts. */
export function isSearchPattern(pattern: unknown, hosts: readonly string[]): pattern is string {
  if (typeof pattern !== 'string' || !pattern.includes('{q}')) return false
  const head = /^https:\/\/([^/?#]*)/.exec(pattern)
  if (!head || head[1].includes('{')) return false
  const filled = pattern.split('{q}').join('q')
  const host = linkHost(filled)
  return host !== null && hostOn(host, hosts)
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() !== '' && v.length <= max ? v : null)
const time = (v: unknown): string | null => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null)
const dayOrNull = (v: unknown): string | null => (isDay(v) ? v : null)
const int = (v: unknown, lo: number, hi: number): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : NaN
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null
}

// ── Stores ───────────────────────────────────────────────────────────────────

function storeFacts(r: Record<string, unknown>): ShopStoreFacts | null {
  if (!has(STORE_KIND, r.kind)) return null
  const name = text(r.name, 80)
  const country = str(r.country), currency = str(r.currency)
  if (!name || !country || !/^[A-Z]{2}$/.test(country) || !currency || !/^[A-Z]{3}$/.test(currency)) return null
  if (!Array.isArray(r.hosts) || r.hosts.length < 1 || r.hosts.length > 20 || !r.hosts.every(isHost)) return null
  const hosts = [...new Set(r.hosts as string[])]
  const searchUrl = r.search_url == null ? null : isSearchPattern(r.search_url, hosts) ? r.search_url : undefined
  const sourceUrl = r.source_url == null ? null : isShownLink(r.source_url) ? r.source_url : undefined
  if (searchUrl === undefined || sourceUrl === undefined) return null
  const template = r.ad_template == null ? null : text(r.ad_template, 4000)
  const language = r.ad_language == null ? null : (typeof r.ad_language === 'string' && /^[a-z]{2,3}$/.test(r.ad_language) ? r.ad_language : undefined)
  if (language === undefined || (template === null) !== (language === null)) return null
  return {
    kind: r.kind, name, country, currency, hosts, search_url: searchUrl, ad_template: template, ad_language: language,
    source_url: sourceUrl, read_on: dayOrNull(r.read_on),
  }
}

/** A store row read back, checked (191's CHECKs): null when it isn't one the app can use. */
export function parseStore(row: unknown): ShopStore | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string' || !UUID_RE.test(r.id) || typeof r.user_id !== 'string' || !r.user_id) return null
  const facts = storeFacts(r)
  if (!facts || (r.origin !== 'seed' && r.origin !== 'page' && r.origin !== 'owner')) return null
  const source = r.source_facts && typeof r.source_facts === 'object' ? storeFacts(r.source_facts as Record<string, unknown>) : null
  const created = time(r.created_at), updated = time(r.updated_at)
  if (!created || !updated) return null
  return {
    ...facts,
    id: r.id, user_id: r.user_id, seed_key: typeof r.seed_key === 'string' && SEED_KEY_RE.test(r.seed_key) ? r.seed_key : null,
    member_tier: text(r.member_tier, 60), hidden: r.hidden === true, origin: r.origin, source,
    owner_edited: r.owner_edited === true, edited_at: time(r.edited_at), created_at: created, updated_at: updated,
  }
}

// ── Rules ────────────────────────────────────────────────────────────────────

/** Whether a rule's facts have each kind's own fields and nothing else (191's shop_store_rules_shape). */
function shapeOk(f: ShopStoreRuleFacts): boolean {
  const noWindow = f.window_from === null && f.window_to === null && f.return_until === null
  switch (f.kind) {
    case 'open_purchase':
    case 'return':
      return f.days !== null && noWindow && f.against === null && f.against_stores === null
    case 'seasonal_return':
      return f.window_from !== null && f.window_to !== null && (f.days === null) !== (f.return_until === null) && f.against === null && f.against_stores === null
    case 'price_match':
      return (f.against === 'listed' || f.against === 'any') && (f.against === 'listed') === (f.against_stores !== null) && f.days === null && noWindow
    case 'price_protection':
      return (f.against === 'own' || f.against === 'any') && f.against_stores === null && f.days !== null && noWindow
  }
}

function ruleFacts(r: Record<string, unknown>): ShopStoreRuleFacts | null {
  if (!has(RULE_KIND, r.kind)) return null
  const days = r.days == null ? null : int(r.days, 1, 400)
  if (r.days != null && days === null) return null
  const md = (v: unknown): string | null | undefined => (v == null ? null : isMonthDay(v) ? v : undefined)
  const from = md(r.window_from), to = md(r.window_to), until = md(r.return_until)
  if (from === undefined || to === undefined || until === undefined) return null
  const exclusions = Array.isArray(r.exclusions) ? r.exclusions : r.exclusions == null ? [] : null
  if (!exclusions || !exclusions.every(e => has(EXCLUSION, e))) return null
  const payout = r.payout == null ? null : has(PAYOUT, r.payout) ? r.payout : undefined
  const against = r.against == null ? null : has(AGAINST, r.against) ? r.against : undefined
  if (payout === undefined || against === undefined) return null
  const stores = r.against_stores == null ? null : Array.isArray(r.against_stores) && r.against_stores.length >= 1 && r.against_stores.length <= 50
    && r.against_stores.every(s => typeof s === 'string' && UUID_RE.test(s)) ? [...new Set(r.against_stores as string[])] : undefined
  const sourceUrl = r.source_url == null ? null : isShownLink(r.source_url) ? r.source_url : undefined
  if (stores === undefined || sourceUrl === undefined) return null
  const facts: ShopStoreRuleFacts = {
    kind: r.kind, label: r.label == null ? null : text(r.label, 60), days, member_tier: r.member_tier == null ? null : text(r.member_tier, 60),
    window_from: from, window_to: to, return_until: until, exclusions: [...new Set(exclusions as ShopRuleExclusion[])].sort(),
    payout, against, against_stores: stores, words: r.words == null ? null : text(r.words, 2000), source_url: sourceUrl,
    read_on: dayOrNull(r.read_on), off: r.off === true,
  }
  return shapeOk(facts) ? facts : null
}

/** A rule row read back, checked (191's CHECKs and shape): null when it isn't one the app can use. */
export function parseStoreRule(row: unknown): ShopStoreRule | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (![r.id, r.store_id].every(x => typeof x === 'string' && UUID_RE.test(x)) || typeof r.user_id !== 'string' || !r.user_id || !has(ORIGIN, r.origin)) return null
  const facts = ruleFacts(r)
  if (!facts) return null
  const source = r.source_facts && typeof r.source_facts === 'object' ? ruleFacts(r.source_facts as Record<string, unknown>) : null
  const created = time(r.created_at), updated = time(r.updated_at)
  if (!created || !updated) return null
  return {
    ...facts,
    id: r.id as string, user_id: r.user_id as string, store_id: r.store_id as string,
    seed_key: typeof r.seed_key === 'string' && SEED_KEY_RE.test(r.seed_key) ? r.seed_key : null, origin: r.origin, source,
    owner_edited: r.owner_edited === true, edited_at: time(r.edited_at), created_at: created, updated_at: updated,
  }
}

/** The facts of a rule an edit may change — every one but its kind's shape is checked here before it is sent. */
export type StoreRulePatch = Partial<Omit<ShopStoreRuleFacts, 'kind'>> & { kind?: ShopStoreRuleKind }

/** What is wrong with a rule after `patch` (the words the owner sees), or null. Checked before the database does. */
export function rulePatchProblem(rule: ShopStoreRuleFacts, patch: StoreRulePatch): string | null {
  const next = { ...rule, ...patch }
  if (next.days !== null && (!Number.isInteger(next.days) || next.days < 1 || next.days > 400)) return 'Days are a whole number from 1 to 400'
  for (const d of [next.window_from, next.window_to, next.return_until]) if (d !== null && !isMonthDay(d)) return 'A window\'s day is a day every year has (DD.MM, no 29.02)'
  if (next.source_url !== null && !isShownLink(next.source_url)) return 'The source must be a https link'
  if (next.read_on !== null && !isDay(next.read_on)) return 'Not a day'
  if (next.label !== null && (next.label.trim() === '' || next.label.length > 60)) return 'A name is at most 60 characters'
  if (next.member_tier !== null && (next.member_tier.trim() === '' || next.member_tier.length > 60)) return 'A member tier is at most 60 characters'
  if (next.words !== null && next.words.length > 2000) return 'The store\'s words are at most 2 000 characters'
  if (!next.exclusions.every(e => has(EXCLUSION, e))) return 'Not an exclusion the app knows'
  if (next.against_stores !== null && (next.against_stores.length < 1 || next.against_stores.length > 50)) return 'A price match names 1 to 50 stores'
  if (!shapeOk(next)) return 'That doesn\'t fit this kind of rule'
  return null
}

// ── The law ──────────────────────────────────────────────────────────────────

/** A law rule read back, checked (191's CHECKs; Norway only, a Lovdata link): null when it isn't one the app can use. */
export function parseLawRule(row: unknown): ShopLawRule | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.slug !== 'string' || !SEED_KEY_RE.test(r.slug) || r.country !== 'NO') return null
  if ((r.kind !== 'cancel' && r.kind !== 'complaint') || !['distance', 'in_store', 'any'].includes(r.channel as string)) return null
  if ((r.seller !== 'business' && r.seller !== 'private') || typeof r.gives_right !== 'boolean') return null
  const days = r.days == null ? null : int(r.days, 1, 400), years = r.years == null ? null : int(r.years, 1, 10)
  if ((r.days != null && days === null) || (r.years != null && years === null)) return null
  if (r.kind === 'cancel' ? r.gives_right !== (days !== null) || years !== null : !r.gives_right || years === null || days !== null) return null
  const name = text(r.name, 80), summary = text(r.summary, 600), law = text(r.law, 200)
  if (!name || !summary || !law || !isShownLink(r.law_url) || linkHost(r.law_url) !== 'lovdata.no' || !isDay(r.checked_on)) return null
  return {
    id: r.id, slug: r.slug, country: 'NO', kind: r.kind, channel: r.channel as ShopLawRule['channel'], seller: r.seller,
    gives_right: r.gives_right, days, years, long_lasting: typeof r.long_lasting === 'boolean' ? r.long_lasting : null,
    counts_from: r.counts_from === 'receipt' || r.counts_from === 'delivery' ? r.counts_from : null, to_workday: r.to_workday === true,
    name, summary, law, law_url: r.law_url, checked_on: r.checked_on,
  }
}

// ── Deal days: 190's rows and the owner's own versions ──────────────────────

/** A deal-day edit read back, checked (190's rule shapes): null when it isn't a whole rule. */
export function parseDealDayEdit(row: unknown): ShopDealDayEdit | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  if (typeof r.user_id !== 'string' || !r.user_id) return null
  // The rule's own fields are 190's: parse them as a deal day with a stand-in day checked.
  const deal = parseDealDay({ ...r, checked_on: '2000-01-01' })
  if (!deal) return null
  return {
    id: deal.id, user_id: r.user_id, slug: deal.slug, name: deal.name, rule_kind: deal.rule_kind, month: deal.month, day: deal.day,
    weekday: deal.weekday, nth: deal.nth, offset_days: deal.offset_days, length_days: deal.length_days, off: r.off === true,
    source_url: r.source_url != null && isShownLink(r.source_url) ? r.source_url : null,
    created_at: String(r.created_at ?? ''), updated_at: String(r.updated_at ?? ''),
  }
}

/** The day an edit was typed: its last change's Oslo day (yyyy-mm-dd), for "typed 12.11.2026". */
const editDay = (e: ShopDealDayEdit): string => osloDay(e.updated_at) ?? osloDay(e.created_at) ?? '2000-01-01'

/** The owner's edit as a deal day the app counts (its day checked = the day it was typed). */
function editAsDeal(e: ShopDealDayEdit): ShopDealDay {
  return {
    id: e.id, slug: e.slug, name: e.name, rule_kind: e.rule_kind, month: e.month, day: e.day, weekday: e.weekday, nth: e.nth,
    offset_days: e.offset_days, length_days: e.length_days, source_url: e.source_url, checked_on: editDay(e),
    created_at: e.created_at, updated_at: e.updated_at, edited: true,
  }
}

/**
 * Every deal day as the owner sees it, by slug: 190's row (`source`), the owner's edit of it (`own`), and what the
 * app counts (`effective`: the edit unless it is turned off, else the shared row). A slug only the owner has is
 * a deal day of their own. In slug order.
 */
export function dealDayRows(shared: readonly ShopDealDay[], edits: readonly ShopDealDayEdit[]): ShopDealDayRow[] {
  const slugs = new Map<string, ShopDealDayRow>()
  for (const d of shared) slugs.set(d.slug, { slug: d.slug, source: d, own: null, effective: d })
  for (const e of edits) {
    const row = slugs.get(e.slug) ?? { slug: e.slug, source: null, own: null, effective: null }
    const deal = editAsDeal(e)
    slugs.set(e.slug, { ...row, own: e, effective: e.off || !dealRuleOf(deal) ? null : deal })
  }
  return [...slugs.values()].sort((a, b) => a.slug.localeCompare(b.slug))
}

/** The deal days the app counts (Needs a look): each slug once, the owner's version first, the ones turned off left out. */
export function effectiveDealDays(rows: readonly ShopDealDayRow[]): ShopDealDay[] {
  return rows.map(r => r.effective).filter((d): d is ShopDealDay => d !== null)
}

/** A slug for a deal day of the owner's own, from its name ("Payday sale" → "payday_sale"); null when none can be made. */
export function dealSlugOf(name: string): string | null {
  const slug = name.toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^[^a-z]+/, '').slice(0, 40).replace(/_+$/, '')
  return SEED_KEY_RE.test(slug) ? slug : null
}
