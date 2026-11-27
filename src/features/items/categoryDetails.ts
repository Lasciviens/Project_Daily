// An item's category add-on fields (migration 215; owner, 27.11.2026: "Category decides how the task's add-on fields
// would show up. Since we use only one (I HOPE!!) task screen; when you choose cinema it should also show some
// additional fields like which movie, which cinema, with who and how much it costed"; "Cinema is media."; "Start with
// games and media."). THE registry: a category (and, for Media, its type) → the fields the item screen shows under it.
// The item screen draws one section from it for Add and Edit wherever it opens; a mode may hide a field, never copy it.
//
// Where each value lives: the movie, show or game is the task's real link (210, app_save_item's p_link — so the thing
// shows "Planned …"); everything else is `tasks.details` (215), saved by the one item save. One source for the
// category and a cinema trip's cinema: an item with a slot or a repeat keeps them there (the slot's category, its
// place); only an item with neither keeps them in its details (the database takes them out otherwise). `cleanDetails` is the browser's copy of 215's
// `task_details_ok` — change the two together (verify-db-item-details compares the lists, verify-item-details the rule).
// The cost is never spending (owner: "Cost not toward my spending no."): nothing that counts money reads it.
import type { TimeBlockCategory } from '../daily/types'
import type { ItemLinkKind } from './itemTypes'

export const MEDIA_TYPES = ['movie', 'tv', 'cinema'] as const
export type MediaType = typeof MEDIA_TYPES[number]
/** The list cinema visits use (120's movie_cinema_visits). */
export const DETAIL_CURRENCIES = ['NOK', 'TRY', 'EUR', 'USD'] as const
export type DetailCurrency = typeof DETAIL_CURRENCIES[number]

/** 215's bounds: a name, how many names, seats / booking / cinema, On, the largest cost. */
export const DETAIL_LIMITS = { name: 40, names: 10, text: 60, on: 30, amount: 1_000_000 } as const

/** What tasks.details holds (215): the category's add-on fields — and, for an item with no slot or repeat, its
 *  category and a cinema trip's cinema. */
export interface ItemDetails {
  category?: TimeBlockCategory
  type?: MediaType
  with?: string[]
  cost?: { amount: number; currency: DetailCurrency }
  seats?: string
  booking?: string
  on?: string
  /** A cinema trip's cinema, by name — kept here only for an item with no slot (one with a slot has its place). */
  cinema?: string
}

/** A field the Details section draws. `thing` is the link (a movie or show, a game); `cinema` names the Location row. */
export type DetailField = 'thing' | 'cinema' | 'with' | 'cost' | 'seats' | 'booking' | 'on'
type StoredKey = Exclude<keyof ItemDetails, 'category'>

export interface CategoryDetailsDef {
  /** The section's heading. */
  heading: string
  /** Media's type choice (a small segmented control); none for a category without types. */
  types?: { value: MediaType; label: string; tip: string }[]
  /** The fields, in the screen's order, for a type. */
  fields: (type: MediaType | undefined) => DetailField[]
  /** The kind of thing the `thing` field links. */
  linkKind?: (type: MediaType | undefined) => ItemLinkKind
}

export const CATEGORY_DETAILS: Partial<Record<TimeBlockCategory, CategoryDetailsDef>> = {
  media: {
    heading: 'Media',
    types: [
      { value: 'movie', label: 'Movie', tip: 'Movie: a film at home' },
      { value: 'tv', label: 'TV', tip: 'TV: a show or an episode' },
      { value: 'cinema', label: 'Cinema', tip: 'Cinema: a film at the cinema — where, with who, the cost and the booking' },
    ],
    fields: type => (type === 'cinema' ? ['thing', 'cinema', 'with', 'cost', 'seats', 'booking'] : ['thing', 'with']),
    linkKind: type => (type === 'tv' ? 'tv' : 'movie'),
  },
  games: {
    heading: 'Games',
    fields: () => ['thing', 'on', 'with'],
    linkKind: () => 'game',
  },
}

/** Which stored key each field writes (the link and the place are stored elsewhere). */
const STORED: Partial<Record<DetailField, StoredKey>> = { with: 'with', cost: 'cost', seats: 'seats', booking: 'booking', on: 'on', cinema: 'cinema' }

export function detailsOf(category: TimeBlockCategory): CategoryDetailsDef | null {
  return CATEGORY_DETAILS[category] ?? null
}

/** The fields the section shows for a category and type ([] = no section). */
export function detailFields(category: TimeBlockCategory, type: MediaType | undefined): DetailField[] {
  return detailsOf(category)?.fields(type) ?? []
}

/** The media type a category starts with: Media's first (Movie); none for the others. */
export function defaultType(category: TimeBlockCategory): MediaType | undefined {
  return detailsOf(category)?.types?.[0]?.value
}

const CATEGORIES: readonly TimeBlockCategory[] = ['daily', 'training', 'media', 'games', 'work', 'projects', 'football', 'other']
// Control characters, and every invisible format character (Unicode Cf: the soft hyphen, the zero-width ones, the
// direction overrides, the word joiners, the byte order mark, the tag characters …) that makes a name read one way and
// be stored another (215's copy lists the same code points; verify-db-item-details compares them).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const INVISIBLE = /\p{Cf}/u

/** A short text as 215 takes it: trimmed, at most `max` characters, something that is not a space, no control character. */
export function cleanText(v: unknown, max: number): string | undefined {
  // Before the spaces are tidied: JavaScript counts U+FEFF as a space, so it would be trimmed away unseen.
  if (typeof v !== 'string' || INVISIBLE.test(v)) return undefined
  const t = v.replace(/\s+/g, ' ').trim()
  return t && t.length <= max && !CONTROL.test(t) ? t : undefined
}

/** Names as 215 takes them: each cleaned, once in any case, at most ten; none = undefined. */
export function cleanNames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const n of v) {
    const t = cleanText(n, DETAIL_LIMITS.name)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === DETAIL_LIMITS.names) break
  }
  return out.length ? out : undefined
}

/** A cost as 215 takes it: 0 to a million with at most two decimals, a currency from the list. */
export function cleanCost(v: unknown): ItemDetails['cost'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const { amount, currency } = v as Record<string, unknown>
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > DETAIL_LIMITS.amount) return undefined
  if (Math.round(amount * 100) / 100 !== amount) return undefined
  if (!DETAIL_CURRENCIES.includes(currency as DetailCurrency)) return undefined
  return { amount, currency: currency as DetailCurrency }
}

const isCategory = (c: unknown): c is TimeBlockCategory => CATEGORIES.includes(c as TimeBlockCategory)

/**
 * The details as 215 keeps them, from anything (what the screen built, or a row read back — a value read is input too):
 * only the category's keys and its type's fields, each cleaned; what doesn't fit is left out. `category`: the item's
 * own (its slot's or repeat's) — it decides, never one stored with older details. Without either, the add-ons are read
 * as Media's when they name a type, else as Games'. null = not details.
 */
export function cleanDetails(raw: unknown, category?: TimeBlockCategory | null): ItemDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const own = isCategory(category) ? category : isCategory(r.category) ? r.category : null
  if (r.category !== undefined && !isCategory(r.category)) return null
  const out: ItemDetails = own ? { category: own } : {}
  const def = own ? detailsOf(own) : MEDIA_TYPES.includes(r.type as MediaType) ? CATEGORY_DETAILS.media! : CATEGORY_DETAILS.games!
  if (!def) return out
  const type = def.types ? (MEDIA_TYPES.includes(r.type as MediaType) ? r.type as MediaType : undefined) : undefined
  if (type) out.type = type
  for (const field of def.fields(type)) {
    const key = STORED[field]
    if (!key) continue
    if (key === 'with') { const v = cleanNames(r.with); if (v) out.with = v }
    else if (key === 'cost') { const v = cleanCost(r.cost); if (v) out.cost = v }
    else { const k = key as 'seats' | 'booking' | 'on' | 'cinema'; const v = cleanText(r[k], k === 'on' ? DETAIL_LIMITS.on : DETAIL_LIMITS.text); if (v) out[k] = v }
  }
  return out
}

/** The screen's cost field ('149,50') read as an amount, or why it can't be saved. '' = no cost. */
export function readAmount(text: string): { amount: number | null } | { problem: string } {
  const t = text.trim().replace(/\s/g, '').replace(',', '.')
  if (!t) return { amount: null }
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(t)) return { problem: 'Cost is an amount like 149 or 149.50' }
  const n = Number(t)
  return n > DETAIL_LIMITS.amount ? { problem: 'Cost is at most 1 000 000' } : { amount: n }
}

/**
 * The owner's own earlier values of one field, newest first, for suggestions (Games' On: "do not add those manually,
 * it will be added after I put them in" — never a seeded list). Rows are input: each value cleaned again; once in any case.
 */
export function earlierValues(rows: readonly { details?: unknown }[], pick: (d: ItemDetails) => readonly string[] | string | undefined, limit = 8): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const row of rows) {
    const d = cleanDetails(row.details)
    const v = d ? pick(d) : undefined
    for (const x of Array.isArray(v) ? v : v ? [v] : []) {
      if (seen.has(x.toLowerCase())) continue
      seen.add(x.toLowerCase())
      out.push(x)
      if (out.length === limit) return out
    }
  }
  return out
}

/** Suggestions for a field as it is typed: the earlier values that start with (then contain) the text, not already picked. */
export function suggestionsFor(earlier: readonly string[], typed: string, picked: readonly string[] = []): string[] {
  const q = typed.trim().toLowerCase()
  const taken = new Set(picked.map(p => p.toLowerCase()))
  const open = earlier.filter(v => !taken.has(v.toLowerCase()) && v.toLowerCase() !== q)
  if (!q) return open
  return [...open.filter(v => v.toLowerCase().startsWith(q)), ...open.filter(v => !v.toLowerCase().startsWith(q) && v.toLowerCase().includes(q))]
}
