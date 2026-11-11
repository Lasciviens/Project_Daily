// The add sheet's autofill (Shop step B, owner, 10.11.2026): what each input gives, as facts — each with its
// source and a confidence word (exact · likely · check) — that the owner can untick or edit, and what is saved.
// Pure — scripts/verify-shop-autofill.cjs runs it.
//
// The inputs, as the 20-product test found them (docs/features/shop.md, "Autofill"):
//   · a link: the page's own schema.org block, through shop-price's `read` (priceRead.ts) — nothing more fetched;
//   · a barcode: the owner's own things first, then groceries (Kassalapp) — no outside source for durable goods;
//   · a title: the owner's own history (similar titles) and the words of the title — no outside lookups.
// "Find it" builds search links from each store's pattern (data, never a store name in code).
import { ean13, modelInName, prisjaktProduct } from './productFacts'
import type { ItemCondition, SpecRow } from './priceRead'
import { fold, listOf, localDay, pickOf, SHOP_CURRENCIES } from './shopModel'
import { money } from './components/shopFormat'
import { formatDate } from '../../shared/utils/dateFormat'
import type { PriceReadResult } from './api/shopPriceApi'
import type { GroceryHit } from './groceryModel'
import { hostOn, linkHost } from './storeRows'
import type { ShopCategory, ShopCurrency, ShopItem, ShopStore } from './types'
import { FORM_FACTS, factKept, fieldHolds } from './factsKept'

// What the save keeps lives in its own small module (the add sheet's save needs only that; the rest loads with
// the autofill's panel). Re-exported, so the autofill reads as one model.
export { FORM_FACTS, factKept, factsToSave, fieldHolds, type SavedFacts } from './factsKept'

/** How sure a fact is: exact — a field of the page's data, a valid barcode; likely — derived; check — a guess. */
export type Confidence = 'exact' | 'likely' | 'check'

/** Which of the owner's inputs gave a fact: a new read of the same input replaces what it gave before. */
export type FactOrigin = 'link' | 'scan' | 'title'

/** Where a fact came from, as the sheet says it ("elkjop.no", "Kassalapp", "your “Sony WH-1000XM4”", "you"). */
export interface FactSource { origin: FactOrigin; label: string }

export interface CategoryFact { topId: string; subId: string; name: string }

export interface FactValues {
  title: string
  price: { amount: number; currency: ShopCurrency }
  image: string
  store: string
  category: CategoryFact
  brand: string
  model: string
  ean: string
  condition: ItemCondition
  returnDays: number
  prisjaktId: string
  specs: SpecRow[]
}
export type FactKey = keyof FactValues

/** One fact: `on` — the owner keeps it; `edited` — the owner changed its value (its source is then "you"). */
export type Fact = { [K in FactKey]: { key: K; value: FactValues[K]; source: FactSource; confidence: Confidence; on: boolean; edited?: boolean; at: string } }[FactKey]

/** The order the sheet lists them in. */
export const FACT_ORDER: readonly FactKey[] = ['title', 'price', 'image', 'store', 'category', 'brand', 'model', 'ean', 'condition', 'returnDays', 'prisjaktId', 'specs']

export const FACT_LABEL: Record<FactKey, string> = {
  title: 'Name', price: 'Price', image: 'Picture', store: 'Store', category: 'Category', brand: 'Brand', model: 'Model',
  ean: 'EAN', condition: 'Condition', returnDays: 'Returns', prisjaktId: 'Prisjakt no.', specs: 'Specs',
}

const CONDITION_WORD: Record<ItemCondition, string> = { new: 'New', used: 'Used', refurbished: 'Refurbished', damaged: 'Damaged' }

const RANK: Record<Confidence, number> = { exact: 3, likely: 2, check: 1 }

/** A fact's value in words, as its row shows it. */
export function factText(f: Fact): string {
  switch (f.key) {
    case 'price': return money(f.value.amount, f.value.currency)
    case 'category': return f.value.name
    case 'condition': return CONDITION_WORD[f.value]
    case 'returnDays': return `${f.value} days`
    case 'specs': return f.value.length === 1 ? '1 row' : `${f.value.length} rows`
    case 'image': return 'A picture'
    default: return f.value
  }
}

// ── The form fields a fact fills ─────────────────────────────────────────────

/** What the facts read and write of the add sheet's draft (ShopDraft's own names). */
export interface FactFields {
  title: string
  price: number | null
  currency: ShopCurrency
  image: string | null
  platform: string
  topId: string
  subId: string
}

function fieldEmpty(key: FactKey, d: FactFields): boolean {
  switch (key) {
    case 'title': return !d.title.trim()
    case 'price': return d.price == null
    case 'image': return !d.image
    case 'store': return !d.platform.trim()
    case 'category': return !d.topId
    default: return true
  }
}

/** The form fields a fact puts in. */
function fieldsOf(f: Fact): Partial<FactFields> {
  switch (f.key) {
    case 'title': return { title: f.value }
    case 'price': return { price: f.value.amount, currency: f.value.currency }
    case 'image': return { image: f.value }
    case 'store': return { platform: f.value }
    case 'category': return { topId: f.value.topId, subId: f.value.subId }
    default: return {}
  }
}

/** The form fields with a fact taken out (the field back to empty). */
function clearedOf(key: FactKey): Partial<FactFields> {
  switch (key) {
    case 'title': return { title: '' }
    case 'price': return { price: null }
    case 'image': return { image: null }
    case 'store': return { platform: '' }
    case 'category': return { topId: '', subId: '' }
    default: return {}
  }
}

// ── Merging what an input gave ───────────────────────────────────────────────

/**
 * The facts after `origin` gave `incoming`: what that input gave before goes (a second link replaces the first),
 * the owner's edits stay, and for each fact the surer one wins — the newer on a tie. In FACT_ORDER.
 */
export function mergeFacts(current: readonly Fact[], origin: FactOrigin, incoming: readonly Fact[]): Fact[] {
  const byKey = new Map<FactKey, Fact>()
  for (const f of current) if (f.edited || f.source.origin !== origin) byKey.set(f.key, f)
  for (const f of incoming) {
    const had = byKey.get(f.key)
    if (had && (had.edited || RANK[had.confidence] > RANK[f.confidence])) continue
    byKey.set(f.key, f)
  }
  return FACT_ORDER.map(k => byKey.get(k)).filter((f): f is Fact => !!f)
}

/**
 * The form fields after the facts changed from `before` to `after`: a kept form fact fills its field when the field
 * is empty or still holds what an earlier fact put there — never over what the owner typed; a form fact that went
 * (or was unticked) empties the field it had filled.
 */
export function fieldsAfter(d: FactFields, before: readonly Fact[], after: readonly Fact[]): Partial<FactFields> {
  const patch: Partial<FactFields> = {}
  for (const key of FORM_FACTS) {
    const was = before.find(f => f.key === key && f.on)
    const now = after.find(f => f.key === key && f.on)
    const filledByWas = !!was && fieldHolds(was, d)
    if (now) {
      if (filledByWas || fieldEmpty(key, d)) Object.assign(patch, fieldsOf(now))
    } else if (filledByWas) {
      Object.assign(patch, clearedOf(key))
    }
  }
  return patch
}

/** Ticks or unticks one fact; a form fact ticked again puts its value back in its field (the owner asked for it). */
export function toggleFact(facts: readonly Fact[], key: FactKey, d: FactFields): { facts: Fact[]; fields: Partial<FactFields> } {
  const f = facts.find(x => x.key === key)
  if (!f) return { facts: [...facts], fields: {} }
  const keep = !factKept(f, d)
  const next = facts.map(x => (x.key === key ? { ...x, on: keep } as Fact : x))
  if (!FORM_FACTS.has(key)) return { facts: next, fields: {} }
  return { facts: next, fields: keep ? fieldsOf(f) : fieldHolds(f, d) ? clearedOf(key) : {} }
}

/** The owner's own value for a fact without a field of its own: kept, its source "you". Empty text unticks it. */
export function editFact(facts: readonly Fact[], key: Exclude<FactKey, 'title' | 'price' | 'image' | 'store' | 'category'>, text: string, at: string): Fact[] {
  return facts.map(f => {
    if (f.key !== key) return f
    const value = parseEdit(f, text)
    if (value == null) return { ...f, on: false } as Fact
    return { ...f, value, on: true, edited: true, confidence: 'exact', source: { origin: f.source.origin, label: 'you' }, at } as Fact
  })
}

/** Spec rows as the owner edits them: one "Name: value" a line. */
export const specsText = (rows: readonly SpecRow[]): string => rows.map(r => (r.value ? `${r.name}: ${r.value}` : r.name)).join('\n')

function parseEdit(f: Fact, text: string): Fact['value'] | null {
  const t = text.trim().slice(0, 2000)
  if (!t) return null
  switch (f.key) {
    case 'ean': return ean13(t.replace(/\s/g, ''))
    case 'returnDays': { const n = Number(t.replace(/\D/g, '')); return Number.isInteger(n) && n > 0 && n < 400 ? n : null }
    case 'condition': { const c = (Object.keys(CONDITION_WORD) as ItemCondition[]).find(k => CONDITION_WORD[k].toLowerCase() === t.toLowerCase()); return c ?? null }
    case 'prisjaktId': return /^\d{1,12}$/.test(t) ? t : null
    case 'specs': {
      const rows = t.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30).map(l => {
        const at = l.indexOf(':')
        return at > 0 ? { name: l.slice(0, at).trim().slice(0, 80), value: l.slice(at + 1).trim().slice(0, 300) } : { name: l.slice(0, 80), value: '' }
      }).filter(r => r.name)
      return rows.length ? rows : null
    }
    default: return t.slice(0, f.key === 'model' ? 64 : 120)
  }
}

// ── What each input gives ────────────────────────────────────────────────────

/** A store row (shop_stores, migration 191) as autofill reads it: its hosts and its search-link pattern. */
export interface StoreRow {
  id: string
  name: string
  kind: 'shop' | 'marketplace' | 'price_site' | 'refurbisher'
  /** Its web addresses' hosts ("elkjop.no"): a link on one of them, or a subdomain, is on this store. */
  hosts: readonly string[]
  /** A search link with `{q}` where the words go ("https://www.prisjakt.no/search?query={q}"), or null. */
  searchPattern: string | null
}

/** The account's stores as autofill reads them: the ones the owner hasn't hidden, each with its search link's pattern. */
export function storeRowsOf(stores: readonly ShopStore[]): StoreRow[] {
  return stores.filter(s => !s.hidden).map(s => ({ id: s.id, name: s.name, kind: s.kind, hosts: s.hosts, searchPattern: s.search_url }))
}

/** "elkjop.no" — a link's host without "www.", lower case; null for anything but a web link. */
export function siteOf(url: string | null | undefined): string | null {
  try {
    const u = new URL(String(url))
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '') : null
  } catch { return null }
}

/** The shop a link is on: a store row's host (exact), else one of the owner's own store names that is the site's name (likely). */
export function storeOf(url: string, stores: readonly StoreRow[], ownStores: readonly string[]): { name: string; confidence: Confidence } | null {
  const site = siteOf(url)
  if (!site) return null
  const row = stores.find(s => s.kind === 'shop' && s.hosts.some(h => { const x = h.toLowerCase().replace(/^www\./, ''); return site === x || site.endsWith(`.${x}`) }))
  if (row) return { name: row.name, confidence: 'exact' }
  const label = fold(site.split('.').slice(-2, -1)[0] ?? '')
  const own = label ? ownStores.find(n => fold(n).replace(/[^a-z0-9]/g, '') === label.replace(/[^a-z0-9]/g, '')) : undefined
  return own ? { name: own, confidence: 'likely' } : null
}

/**
 * The facts a link's read gives (shop-price `read`): every field of the page's data block, exact — but a model
 * guessed from the name is "check", spec rows are "likely" (Prisjakt flattens its lists), and a Prisjakt price that
 * mixes in used offers is "check". A refused link gives none.
 */
export function factsFromRead(r: PriceReadResult, stores: readonly StoreRow[], ownStores: readonly string[], at: string): Fact[] {
  if (r.status === 'not_allowed') return []
  const source: FactSource = { origin: 'link', label: siteOf(r.finalUrl) ?? 'the link' }
  const out: Fact[] = []
  const add = (f: Omit<Fact, 'source' | 'on' | 'at'>) => out.push({ ...f, source, on: true, at } as Fact)
  if (r.name) add({ key: 'title', value: r.name, confidence: 'exact' })
  const currency = (r.currency ?? '').toUpperCase() as ShopCurrency
  if (r.status === 'ok' && r.low != null && SHOP_CURRENCIES.includes(currency)) {
    add({ key: 'price', value: { amount: r.low, currency }, confidence: r.source === 'prisjakt' && r.condition !== 'new' ? 'check' : 'exact' })
  }
  if (r.image) add({ key: 'image', value: r.image, confidence: 'exact' })
  if (r.source === 'store') {
    const store = storeOf(r.finalUrl, stores, ownStores)
    if (store) add({ key: 'store', value: store.name, confidence: store.confidence })
  }
  if (r.brand) add({ key: 'brand', value: r.brand, confidence: 'exact' })
  if (r.model) add({ key: 'model', value: r.model, confidence: r.modelFrom === 'data' ? 'exact' : 'check' })
  const ean = ean13(r.ean)
  if (ean) add({ key: 'ean', value: ean, confidence: 'exact' })
  if (r.itemCondition) add({ key: 'condition', value: r.itemCondition, confidence: 'exact' })
  if (r.returnDays != null) add({ key: 'returnDays', value: r.returnDays, confidence: 'exact' })
  if (r.prisjaktId) add({ key: 'prisjaktId', value: r.prisjaktId, confidence: 'exact' })
  if (r.specs?.length) add({ key: 'specs', value: r.specs, confidence: 'likely' })
  return out
}

/** The facts a scanned barcode gives: its EAN (exact, when its check digit holds) and a grocery's name, brand and picture (Kassalapp). */
export function factsFromScan(ean: string, grocery: GroceryHit | null, at: string): Fact[] {
  const code: FactSource = { origin: 'scan', label: 'the barcode' }
  const out: Fact[] = [{ key: 'ean', value: ean, source: code, confidence: 'exact', on: true, at }]
  if (!grocery) return out
  const kassalapp: FactSource = { origin: 'scan', label: 'Kassalapp' }
  if (grocery.name) out.push({ key: 'title', value: grocery.name.slice(0, 300), source: kassalapp, confidence: 'exact', on: true, at })
  if (grocery.brand) out.push({ key: 'brand', value: grocery.brand.slice(0, 120), source: kassalapp, confidence: 'exact', on: true, at })
  if (grocery.image && /^https:\/\//i.test(grocery.image)) out.push({ key: 'image', value: grocery.image, source: kassalapp, confidence: 'exact', on: true, at })
  return out
}

/** A title's words, folded: "Sony WH-1000XM5 (svart)" → ["sony", "wh", "1000xm5", "svart"]. */
export function titleWords(title: string): string[] {
  return fold(title.slice(0, 300)).split(/[^a-z0-9]+/).filter(w => w.length >= 2)
}

/** A title folded for comparing: "Sony  WH-1000XM5" and "sony wh 1000xm5" are one. */
export const normTitle = (title: string): string => titleWords(title).join(' ')

function similarity(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0
  const sa = new Set(a), sb = new Set(b)
  let both = 0
  for (const w of sa) if (sb.has(w)) both++
  return both / (sa.size + sb.size - both)
}

/** The owner's things a title is like (a wishlist-side product, newest first among equals), with how alike: 0.5 and up. */
export function similarItems(title: string, items: readonly ShopItem[]): { item: ShopItem; score: number }[] {
  const words = titleWords(title)
  if (!words.length || (words.length === 1 && words[0].length < 4)) return []
  return items
    .filter(i => listOf(i) === 'wishlist' && (i.kind ?? 'item') === 'item')
    .map(item => ({ item, score: similarity(words, titleWords(item.title)) }))
    .filter(x => x.score >= 0.5)
    .sort((a, b) => b.score - a.score || b.item.created_at.localeCompare(a.item.created_at))
}

const sureness = (score: number): Confidence => (score >= 0.75 ? 'likely' : 'check')

/** "your “Sony WH-1000XM4”" — a thing of the owner's as a source. */
const yours = (item: ShopItem): string => `your “${item.title.slice(0, 60)}”`

/**
 * What a typed title gives, from the owner's own things only (no outside lookups): the category, the store and
 * what was paid of the most alike ones (likely when the titles are close, else check), and the title's own words —
 * a brand the owner has saved before (likely) or its first word (check), and a model code in it (check).
 */
export function factsFromTitle(title: string, items: readonly ShopItem[], categories: readonly ShopCategory[], at: string): Fact[] {
  const t = title.trim()
  if (!t) return []
  const out: Fact[] = []
  const similar = similarItems(t, items)
  const withCategory = similar.find(x => x.item.category_id && categories.some(c => c.id === x.item.category_id))
  if (withCategory) {
    const pick = pickOf(withCategory.item.category_id, categories)
    const cat = categories.find(c => c.id === withCategory.item.category_id)
    const top = categories.find(c => c.id === pick.topId)
    const name = cat && top && cat.id !== top.id ? `${top.name} · ${cat.name}` : cat?.name ?? ''
    if (name) out.push({ key: 'category', value: { ...pick, name }, source: { origin: 'title', label: yours(withCategory.item) }, confidence: sureness(withCategory.score), on: true, at })
  }
  const withStore = similar.find(x => (x.item.platform ?? '').trim())
  if (withStore) out.push({ key: 'store', value: (withStore.item.platform ?? '').trim().slice(0, 120), source: { origin: 'title', label: yours(withStore.item) }, confidence: sureness(withStore.score), on: true, at })
  const paid = similar.find(x => x.item.status === 'bought' && !x.item.got_as_gift && x.item.price != null && x.item.price > 0
    && SHOP_CURRENCIES.includes((x.item.currency ?? 'NOK') as ShopCurrency))
  if (paid) {
    const day = paid.item.bought_at ? `, paid ${formatDate(localDay(paid.item.bought_at))}` : ''
    out.push({ key: 'price', value: { amount: paid.item.price as number, currency: (paid.item.currency ?? 'NOK') as ShopCurrency },
      source: { origin: 'title', label: `${yours(paid.item)}${day}` }, confidence: sureness(paid.score), on: true, at })
  }
  const brand = brandInTitle(t, items)
  if (brand) out.push({ key: 'brand', value: brand.name, source: { origin: 'title', label: 'the title' }, confidence: brand.confidence, on: true, at })
  const model = modelInName(t)
  if (model) out.push({ key: 'model', value: model, source: { origin: 'title', label: 'the title' }, confidence: 'check', on: true, at })
  return out
}

/** A brand at the start of a title: one the owner saved before (likely), else a capitalised first word of a longer title (check). */
export function brandInTitle(title: string, items: readonly ShopItem[]): { name: string; confidence: Confidence } | null {
  const words = title.trim().split(/\s+/)
  const first = words[0] ?? ''
  const known = new Map<string, string>()
  for (const i of items) { const b = i.facts?.brand?.value; if (typeof b === 'string' && b.trim()) known.set(fold(b), b.trim()) }
  for (const n of [3, 2, 1]) {
    const lead = fold(words.slice(0, n).join(' '))
    if (words.length >= n && known.has(lead)) return { name: known.get(lead) as string, confidence: 'likely' }
  }
  if (words.length >= 2 && /^\p{Lu}[\p{L}&-]{1,19}$/u.test(first)) return { name: first, confidence: 'check' }
  return null
}

// ── "You may already have this" ──────────────────────────────────────────────

export interface Duplicate { item: ShopItem; by: 'ean' | 'prisjakt' | 'title' }

/** What a new thing is told by: its EAN, Prisjakt's product number (a fact, or its link's) and its title. */
export interface DuplicateProbe { title: string; ean: string | null; prisjaktId: string | null; url: string }

/** A row's Prisjakt number: its link's, else a kept fact's. */
function prisjaktOf(item: ShopItem): string | null {
  const v = item.facts?.prisjakt_id?.value
  return prisjaktProduct(item.url ?? '') ?? (typeof v === 'string' && /^\d{1,12}$/.test(v) ? v : null)
}

/**
 * The owner's things a new one may be (never a block on the add): the same EAN, the same Prisjakt product, or the
 * same title once folded — things to buy and things owned, not gone, not quick-list errands. EAN first, at most 3.
 */
export function duplicatesOf(p: DuplicateProbe, items: readonly ShopItem[]): Duplicate[] {
  const ean = ean13(p.ean)
  const pj = p.prisjaktId ?? prisjaktProduct(p.url.trim())
  const title = normTitle(p.title)
  const out: Duplicate[] = []
  const seen = new Set<string>()
  const live = items.filter(i => listOf(i) === 'wishlist' && (i.kind ?? 'item') === 'item' && (i.status === 'wishlist' || i.status === 'bought') && !i.disposal)
  const take = (by: Duplicate['by'], hit: (i: ShopItem) => boolean) => {
    for (const item of live) if (!seen.has(item.id) && hit(item)) { seen.add(item.id); out.push({ item, by }) }
  }
  if (ean) take('ean', i => ean13(i.ean) === ean)
  if (pj) take('prisjakt', i => prisjaktOf(i) === pj)
  if (title.length >= 3) take('title', i => normTitle(i.title) === title)
  return out.slice(0, 3)
}

/** The owner's own things with a scanned barcode's EAN (to buy or owned, not gone) — asked before any outside source. */
export function ownWithEan(ean: string, items: readonly ShopItem[]): ShopItem[] {
  return duplicatesOf({ title: '', ean, prisjaktId: null, url: '' }, items).map(d => d.item)
}

/** "You already have this" for a thing owned, "Already on your wishlist" for one to buy — a scanned barcode's own things. */
export function ownedWords(item: ShopItem): string {
  return item.status === 'bought' ? 'You already have this' : 'Already on your wishlist'
}

// ── "Find it": search links ──────────────────────────────────────────────────

/** The longest search kept (Prisjakt's search box takes 150 characters). */
export const SEARCH_MAX = 150

/**
 * The words to search with: the kept brand + model code when there are both, else — after a scan that found
 * nothing — the barcode's digits, else the title, else the EAN.
 */
export function searchWords(facts: readonly Fact[], d: FactFields, failedScan: string | null): string {
  const kept = (k: FactKey) => facts.find(f => f.key === k && factKept(f, d))
  const brand = kept('brand'), model = kept('model')
  let words = brand && model ? `${String(brand.value)} ${String(model.value)}` : failedScan ?? (d.title.trim() || String(kept('ean')?.value ?? ''))
  words = words.replace(/\s+/g, ' ').trim()
  if (words.length <= SEARCH_MAX) return words
  const cut = words.slice(0, SEARCH_MAX)
  const space = cut.lastIndexOf(' ')
  return space > 40 ? cut.slice(0, space) : cut
}

/**
 * A store's search link for `words`: its pattern with the words in place of its one `{q}`, only when the result is
 * an https web address without a user name (a pattern is data — this is the last line that refuses a bad one).
 */
export function searchLink(pattern: string | null, words: string): string | null {
  const w = words.trim()
  if (!pattern || !w || pattern.length > 300 || pattern.split('{q}').length !== 2) return null
  try {
    const u = new URL(pattern.replace('{q}', encodeURIComponent(w)))
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password ? u.href : null
  } catch { return null }
}

/**
 * The search links to show: each store with a pattern that builds one on its own web address (a host of the row
 * or a subdomain of one — storeRules.searchLinkFor's rule; 191 checks the pattern too), in the stores' order.
 */
export function findItLinks(stores: readonly StoreRow[], words: string): { store: StoreRow; url: string }[] {
  return stores.flatMap(store => {
    const url = searchLink(store.searchPattern, words)
    const host = url ? linkHost(url) : null
    return url && host !== null && hostOn(host, store.hosts) ? [{ store, url }] : []
  })
}
