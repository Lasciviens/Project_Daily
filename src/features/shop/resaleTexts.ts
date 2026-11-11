// The ad's text and the hand-over checklist (Shop step C; owner, 10.11.2026: ad texts in Norwegian, a template per
// marketplace, editable). Pure — scripts/verify-shop-resale.cjs.
//
// Templates and checklists are the owner's own rows (shop_ad_templates, shop_handover_checklists, migration 192).
// A thing's template: its marketplace's for its category, else its marketplace's for any category, else any
// marketplace's for its category, else any marketplace's for any. Its checklist: its subcategory's, else its top
// category's. Categories match as the suggestions do (shopTaxonomy: no case or spaces, "&" = "and", and other
// names for the same thing — "Mobile phones" is Phones). A template's fields are {name}, {condition}, {bought},
// {price} and {accessories}; a line whose field has nothing to say is left out, a field the app doesn't know is
// left as typed (and named). The text only ever holds what the owner chose for the ad — never a serial number,
// who bought it, or anything else from the record.

import { formatDate } from '../../shared/utils/dateFormat'
import { categoryPath } from './shopModel'
import { categoryKey, taxonomySubOf, taxonomyTopOf } from './shopTaxonomy'
import type { AdLanguage, ResaleCondition, ShopAdTemplate, ShopHandoverChecklist } from './resaleTypes'
import type { ShopCategory } from './types'

export const AD_FIELDS = ['name', 'condition', 'bought', 'price', 'accessories'] as const
export type AdField = typeof AD_FIELDS[number]

/** The condition in the ad's own language (Norwegian as FINN's sellers write it). */
export const CONDITION_WORDS: Readonly<Record<AdLanguage, Readonly<Record<ResaleCondition, string>>>> = {
  nb: { new: 'ubrukt', like_new: 'som ny', good: 'pent brukt', fair: 'godt brukt', for_parts: 'defekt, selges som delevare' },
  en: { new: 'unused', like_new: 'like new', good: 'good', fair: 'fair, with signs of use', for_parts: 'for parts, not working' },
}

/** What the ad says about the thing — chosen in the ad sheet, never read from private facts. */
export interface AdFacts {
  name:         string
  condition?:   ResaleCondition | null
  /** yyyy-mm-dd: the day it was bought. */
  bought?:      string | null
  /** The day is approximate (added from memory): "ca." in front. */
  approx?:      boolean
  /** The asking price, in `currency`. */
  price?:       number | null
  currency?:    string
  /** What goes with it, each as the owner calls it. */
  accessories?: readonly string[]
}

/** "4 490" with a plain space (an ad is pasted into another site). */
function amount(n: number): string {
  const r = Math.round(n)
  return `${r < 0 ? '-' : ''}${String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`
}

/** "A, B og C" / "A, B and C". */
function listWords(xs: readonly string[], lang: AdLanguage): string {
  // Each name on one line, as `name` (a newline in one would start a line of its own in the ad).
  const ys = xs.map(x => x.replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (ys.length <= 1) return ys[0] ?? ''
  return `${ys.slice(0, -1).join(', ')} ${lang === 'nb' ? 'og' : 'and'} ${ys[ys.length - 1]}`
}

/** Each field's words in the template's language; '' = nothing to say (its line goes). */
export function fieldValues(facts: AdFacts, lang: AdLanguage): Record<AdField, string> {
  const cur = (facts.currency ?? 'NOK').toUpperCase()
  return {
    name:        facts.name.replace(/\s+/g, ' ').trim(),
    condition:   facts.condition ? CONDITION_WORDS[lang][facts.condition] : '',
    bought:      facts.bought ? `${facts.approx ? (lang === 'nb' ? 'ca. ' : 'about ') : ''}${formatDate(facts.bought)}` : '',
    price:       facts.price != null && Number.isFinite(facts.price) && facts.price >= 0
                   ? `${amount(facts.price)} ${lang === 'nb' && cur === 'NOK' ? 'kr' : cur}` : '',
    accessories: listWords(facts.accessories ?? [], lang),
  }
}

const FIELD_RE = /\{([a-z_]+)\}/g
const isField = (f: string): f is AdField => (AD_FIELDS as readonly string[]).includes(f)

/** One line filled in; null when a field in it has nothing to say (the line goes). */
function fillLine(line: string, values: Record<AdField, string>, unknown: Set<string>): string | null {
  let empty = false
  const out = line.replace(FIELD_RE, (whole, f: string) => {
    if (!isField(f)) { unknown.add(f); return whole }
    if (!values[f]) empty = true
    return values[f]
  })
  return empty ? null : out
}

export interface FilledAd {
  title:   string
  body:    string
  /** Fields the template names that the app doesn't know (left as typed). */
  unknown: string[]
}

/** The template with the thing's facts in it. */
export function fillAd(t: Pick<ShopAdTemplate, 'title' | 'body' | 'language'>, facts: AdFacts): FilledAd {
  const values = fieldValues(facts, t.language)
  const unknown = new Set<string>()
  const title = (fillLine(t.title, values, unknown) ?? values.name).replace(/\s+/g, ' ').trim()
  const lines = t.body.replace(/\r\n?/g, '\n').split('\n').map(l => fillLine(l, values, unknown)).filter((l): l is string => l !== null)
  const body = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { title, body, unknown: [...unknown].sort() }
}

/** The fields a template names that the app doesn't know (so an editor can say so before it is saved). */
export function unknownFields(textOf: string): string[] {
  return [...new Set([...textOf.matchAll(FIELD_RE)].map(m => m[1]).filter(f => !isField(f)))].sort()
}

// ── Which template, which checklist ──────────────────────────────────────────

/** A thing's category names, its subcategory first, then its top category ([] for none). */
export function categoryNamesOf(categoryId: string | null | undefined, categories: readonly ShopCategory[]): string[] {
  const p = categoryPath(categoryId, categories)
  return p.topId === null ? [] : [p.subName, p.topName].filter((n): n is string => !!n)
}

/** Two category names for the same thing: the same words (no case, spaces, "&"/"and"), or the same suggestion. */
export function sameCategory(a: string, b: string): boolean {
  if (categoryKey(a) === categoryKey(b)) return true
  const sa = taxonomySubOf(a), sb = taxonomySubOf(b)
  if (sa && sb) return sa === sb
  const ta = taxonomyTopOf(a), tb = taxonomyTopOf(b)
  return !!ta && ta === tb && !sa && !sb
}

/** How well a row's category fits a thing's names (its subcategory first, then its top): 0 best, -1 no fit. */
function fit(category: string | null, names: readonly string[]): number {
  if (category === null) return names.length
  const i = names.findIndex(n => sameCategory(category, n))
  return i
}

/**
 * The template for an ad on `marketplace` (a host, or null for another place) about a thing in `categoryNames`
 * (its subcategory first, then its top category): its marketplace's before any marketplace's, a category's before
 * any category's, the subcategory's before the top's. Null when there is none.
 */
export function templateFor(templates: readonly ShopAdTemplate[], marketplace: string | null, categoryNames: readonly string[]): ShopAdTemplate | null {
  let best: { t: ShopAdTemplate; rank: number } | null = null
  for (const t of templates) {
    if (t.marketplace !== null && t.marketplace !== marketplace) continue
    const f = fit(t.category, categoryNames)
    if (f < 0) continue
    const rank = (t.marketplace === null ? 1000 : 0) + f
    if (!best || rank < best.rank || (rank === best.rank && t.created_at < best.t.created_at)) best = { t, rank }
  }
  return best?.t ?? null
}

/** The hand-over checklist for a thing in `categoryNames` (its subcategory's before its top category's), or null. */
export function checklistFor(checklists: readonly ShopHandoverChecklist[], categoryNames: readonly string[]): ShopHandoverChecklist | null {
  for (const name of categoryNames) {
    const hit = checklists.filter(c => sameCategory(c.category, name)).sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    if (hit) return hit
  }
  return null
}
