// "Tidy up info" in Shop (owner, 23.11.2026): the AI suggests a cleaner name, brand, model and category for a thing; the
// owner reviews each field (before → after) and nothing is written without a tick and a tap. What code does around the
// model lives here, pure (scripts/verify-shop-tidy.cjs):
//   · what is sent: the thing's name, brand, model and category now, and the owner's OWN category list (numbered by the
//     function: the model never sees an id);
//   · the second check of the answer (the function checked it once): only name, brand, model and a category id that was
//     sent can come through — never a link, picture, price or date, and a name must still share a word with the old one;
//   · the fields to review, the write that saves the ticked ones, and the write that puts exactly the old values back;
//   · the worst-case cost to show before "all things" is started.
// The store's words are kept (no translation): an exception to "saved data is English", like the owner's own typed words.
import { listOf } from './shopModel'
import type { ShopCategory, ShopFact, ShopItem, ShopItemFacts, UpdateShopItemInput } from './types'

export const TIDY_SOURCE = 'Tidy up (AI)'
export const TIDY_LIMITS = { name: 120, word: 60, path: 60, categories: 120, searches: 2, factText: 120 } as const

export type TidyKey = 'name' | 'brand' | 'model' | 'category'

/** What the function answers for one thing, after both checks. Each field is present only when it is a real suggestion. */
export interface TidySuggestion { name?: string; brand?: string; model?: string; category_id?: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
// Zero-width and text-direction characters draw nothing and can hide a word from a check: out first.
const oneLine = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  // eslint-disable-next-line no-control-regex -- control and invisible characters are exactly what is taken out
  const t = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim()
  return t && [...t].length <= max ? t : null
}
/** A web address (any "name.tld") or a path in a text that must be a plain name; a product name that trips it is dropped, the safe side. */
const LINKISH = /https?:|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b|\//i
const wordsOf = (s: string): Set<string> => new Set(s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])

/** What a thing has now, as the tidy compares it. */
export function currentOf(item: ShopItem): { name: string; brand: string; model: string } {
  const text = (f: ShopFact | undefined) => (typeof f?.value === 'string' ? f.value : '')
  return { name: item.title.replace(/\s+/g, ' ').trim(), brand: text(item.facts?.brand), model: text(item.facts?.model) }
}

/**
 * The function's answer for one thing, checked again here with the same rules: a name of at most 120 characters, no
 * link, still sharing a word with the old name, brand or model; a brand or model of at most 60, no link, not equal to
 * what is there; a category id only when it is one that was sent (`allowedIds`). A value that fails is dropped, never
 * repaired; null when nothing is left to suggest.
 */
export function readTidySuggestion(raw: unknown, item: ShopItem, allowedIds: ReadonlySet<string>): TidySuggestion | null {
  if (!isObj(raw)) return null
  const now = currentOf(item)
  const before = wordsOf(`${now.name} ${now.brand} ${now.model}`)
  const out: TidySuggestion = {}
  const name = oneLine(raw.name, TIDY_LIMITS.name)
  if (name && !LINKISH.test(name) && name !== now.name && [...wordsOf(name)].some(w => before.has(w))) out.name = name
  const brand = oneLine(raw.brand, TIDY_LIMITS.word)
  if (brand && !LINKISH.test(brand) && brand !== now.brand) out.brand = brand
  const model = oneLine(raw.model, TIDY_LIMITS.word)
  if (model && !LINKISH.test(model) && model !== now.model) out.model = model
  if (typeof raw.category_id === 'string' && allowedIds.has(raw.category_id) && raw.category_id !== item.category_id) out.category_id = raw.category_id
  return Object.keys(out).length ? out : null
}

/** The things "all" tidies: wishes and things you own (accessories too), never the quick list's groceries or a general wish. */
export function tidyScope(items: readonly ShopItem[]): ShopItem[] {
  return items.filter(i => listOf(i) === 'wishlist' && i.kind !== 'general' && i.status !== 'dropped')
}

/** The owner's own categories as the function takes them: "Top" and "Top / Sub", paths cut to 60, at most 120 (tops first). */
export function tidyCategories(categories: readonly ShopCategory[]): { id: string; path: string }[] {
  const byId = new Map(categories.map(c => [c.id, c]))
  const cut = (s: string) => [...s.replace(/\s+/g, ' ').trim()].slice(0, TIDY_LIMITS.path).join('')
  const rows = categories.map(c => {
    const top = c.parent_id ? byId.get(c.parent_id) : undefined
    return { id: c.id, path: cut(top ? `${top.name} / ${c.name}` : c.name), sub: !!top }
  }).filter(r => r.path)
  rows.sort((a, b) => Number(a.sub) - Number(b.sub) || a.path.localeCompare(b.path))
  return rows.slice(0, TIDY_LIMITS.categories).map(({ id, path }) => ({ id, path }))
}

/** The job's input for one thing. The brand and model are sent as they are saved now. */
export function tidyInputFor(item: ShopItem, categories: readonly { id: string; path: string }[], pathOfCategory: (id: string | null) => string): Record<string, unknown> {
  const now = currentOf(item)
  return { item: { name: now.name.slice(0, 200), brand: now.brand, model: now.model, category: pathOfCategory(item.category_id) }, categories }
}

/** One field of the review: what is there, and what is suggested. */
export interface TidyChange { key: TidyKey; label: string; before: string; after: string }

const LABEL: Record<TidyKey, string> = { name: 'Name', brand: 'Brand', model: 'Model', category: 'Category' }

/**
 * The fields to review. A brand or model the owner typed themselves (source "you") is never replaced by a read, so it is
 * not offered. `pathOf` words a category id ("Electronics / Headphones").
 */
export function tidyChanges(item: ShopItem, s: TidySuggestion, pathOf: (id: string | null) => string): TidyChange[] {
  const now = currentOf(item)
  const mine = (k: 'brand' | 'model') => item.facts?.[k]?.source === 'you'
  const out: TidyChange[] = []
  if (s.name) out.push({ key: 'name', label: LABEL.name, before: now.name, after: s.name })
  if (s.brand && !mine('brand')) out.push({ key: 'brand', label: LABEL.brand, before: now.brand || '—', after: s.brand })
  if (s.model && !mine('model')) out.push({ key: 'model', label: LABEL.model, before: now.model || '—', after: s.model })
  if (s.category_id) out.push({ key: 'category', label: LABEL.category, before: pathOf(item.category_id), after: pathOf(s.category_id) })
  return out
}

const factOf = (value: string): ShopFact => ({ value, source: TIDY_SOURCE, confidence: 'check' })

/**
 * The write for the ticked fields: `title` and `category_id` are their columns, brand and model are facts
 * ({ value, source "Tidy up (AI)", confidence "check" }, added to the facts the thing has, never replacing another key).
 * Nothing else is ever in it: no link, picture, price or date.
 */
export function tidyPatch(item: ShopItem, s: TidySuggestion, keys: ReadonlySet<TidyKey>): UpdateShopItemInput {
  const patch: UpdateShopItemInput = {}
  if (keys.has('name') && s.name) patch.title = s.name
  if (keys.has('category') && s.category_id) patch.category_id = s.category_id
  const facts: ShopItemFacts = { ...(item.facts ?? {}) }
  let changed = false
  if (keys.has('brand') && s.brand) { facts.brand = factOf(s.brand); changed = true }
  if (keys.has('model') && s.model) { facts.model = factOf(s.model); changed = true }
  if (changed) patch.facts = facts
  return patch
}

/** The write that puts back exactly what was there before, for the same fields (the facts whole, as they were, or none). */
export function tidyUndoPatch(item: ShopItem, patch: UpdateShopItemInput): UpdateShopItemInput {
  const back: UpdateShopItemInput = {}
  if (patch.title !== undefined) back.title = item.title
  if (patch.category_id !== undefined) back.category_id = item.category_id
  if (patch.facts !== undefined) back.facts = item.facts ?? null
  return back
}

/** The prices the estimate needs, as `describe` gives them (the app's own type has more; this is all it reads). */
export interface TidyPrices {
  webSearchUsdEach: number
  longPromptOverTokens: number
  longPromptMultiplier: number
  model: { cacheWrite1hPerMTok: number; outputPerMTok: number }
}

/**
 * The most ONE call could cost, worked out as the function reserves it (`worstCostOf`): the prompt at one token per
 * character plus 1000, read again for each round of a 2-search call (3 rounds) with 25,000 result tokens a search so far,
 * all at the one-hour write price, the whole answer limit as output, and each search's fee. The long-prompt price is
 * counted whenever the reads pass its line (the safe side). The real cost is a small part of this.
 */
export function tidyWorstCost(prices: TidyPrices, chars: { instructions: number; input: number }, maxOutputTokens: number): number {
  const n = TIDY_LIMITS.searches
  const prompt = chars.instructions + chars.input + 1000
  const reads = (n + 1) * prompt + (n * (n + 1) / 2) * 25_000
  const long = reads > prices.longPromptOverTokens ? prices.longPromptMultiplier : 1
  const tokens = (reads * prices.model.cacheWrite1hPerMTok + maxOutputTokens * prices.model.outputPerMTok) / 1_000_000
  return Math.round((tokens * long + n * prices.webSearchUsdEach) * 1_000_000) / 1_000_000
}

/** A thing's name for the progress line: one short line. */
export const shortName = (item: ShopItem): string => [...item.title.replace(/\s+/g, ' ').trim()].slice(0, 40).join('')
