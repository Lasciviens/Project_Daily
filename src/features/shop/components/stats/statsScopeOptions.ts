// What the Stats filter sheet offers — categories (top, then their
// subcategories), money chains, things (accessories under their item) and
// stores — and the chips that name the picks. Pure — scripts/verify-shop-owned.cjs.
import type { ShopCategory, ShopItem } from '../../types'
import { categoryPath, fold } from '../../shopModel'
import { boughtOn, DISPOSAL_LABEL } from '../../ownModel'
import { chainPath, chainTitle, type Chain } from '../../chainModel'
import { byStore, NO_CATEGORY, spendRows, type ScopeSection, type StatsScope } from '../../statsModel'
import { dayOf, join } from './drillTypes'

export interface ScopeOption {
  key: string
  /** As listed in the sheet (a subcategory by its own name). */
  label: string
  /** As a chip under the period row ("Electronics › Phones"). */
  chip: string
  /** A second, muted line. */
  meta?: string
  /** Things in it (purchases, for a store). */
  count?: number
  depth: 0 | 1
  /** A subcategory's top category, an accessory's item: picking that one takes this one along. */
  parent?: string
  /** Things: the folded title, for search. */
  search?: string
}

export type ScopeOptions = Record<ScopeSection, ScopeOption[]>

const byName = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' })

/** Every option, from the things you bought (not narrowed by the filter itself). */
export function scopeOptions(items: readonly ShopItem[], categories: readonly ShopCategory[], chains: readonly Chain[]): ScopeOptions {
  const rows = spendRows(items)
  return { categories: categoryOptions(rows, items, categories), chains: chainOptions(chains), things: thingOptions(rows), stores: storeOptions(items) }
}

function categoryOptions(rows: readonly ShopItem[], items: readonly ShopItem[], categories: readonly ShopCategory[]): ScopeOption[] {
  const byId = new Map(items.map(i => [i.id, i]))
  const tops = new Map<string, { name: string; count: number; subs: Map<string, { name: string; count: number }> }>()
  let none: number | null = null
  for (const i of rows) {
    // An accessory counts with its item (it follows the item's category).
    const owner = (i.accessory_of && byId.get(i.accessory_of)) || i
    const add = i === owner ? 1 : 0
    const p = categoryPath(owner.category_id, categories)
    if (!p.topId) { none = (none ?? 0) + add; continue }
    const t = tops.get(p.topId) ?? { name: p.topName, count: 0, subs: new Map() }
    t.count += add
    if (p.subName && owner.category_id) {
      const sub = t.subs.get(owner.category_id) ?? { name: p.subName, count: 0 }
      sub.count += add
      t.subs.set(owner.category_id, sub)
    }
    tops.set(p.topId, t)
  }
  const out: ScopeOption[] = []
  for (const [id, t] of [...tops].sort((a, b) => byName(a[1].name, b[1].name))) {
    out.push({ key: id, label: t.name, chip: t.name, count: t.count, depth: 0 })
    for (const [subId, sub] of [...t.subs].sort((a, b) => byName(a[1].name, b[1].name))) {
      out.push({ key: subId, label: sub.name, chip: `${t.name} › ${sub.name}`, count: sub.count, depth: 1, parent: id })
    }
  }
  if (none != null) out.push({ key: NO_CATEGORY, label: 'No category', chip: 'No category', count: none, depth: 0 })
  return out
}

function chainOptions(chains: readonly Chain[]): ScopeOption[] {
  return chains.map(c => ({
    key: c.id, label: chainTitle(c), chip: chainTitle(c), meta: c.name ? chainPath(c) : undefined,
    count: c.nodes.filter(nd => nd.state !== 'wish').length, depth: 0 as const,
  }))
}

/** "20.08.2026 · AliExpress · Sold". */
function thingMeta(i: ShopItem): string {
  const state = i.disposal ? DISPOSAL_LABEL[i.disposal] : i.kept === false ? 'Bought for someone else' : null
  return join([dayOf(i, boughtOn(i)), i.platform?.trim(), state])
}

/** Newest first; an accessory under its item (oldest first) when the item is a thing you bought too. */
function thingOptions(rows: readonly ShopItem[]): ScopeOption[] {
  const ids = new Set(rows.map(i => i.id))
  const day = (i: ShopItem) => boughtOn(i) ?? ''
  const acc = new Map<string, ShopItem[]>()
  for (const i of rows) if (i.accessory_of && ids.has(i.accessory_of)) acc.set(i.accessory_of, [...(acc.get(i.accessory_of) ?? []), i])
  const out: ScopeOption[] = []
  const tops = rows.filter(i => !(i.accessory_of && ids.has(i.accessory_of))).sort((a, b) => day(b).localeCompare(day(a)) || byName(a.title, b.title))
  for (const i of tops) {
    out.push({ key: i.id, label: i.title, chip: i.title, meta: thingMeta(i), depth: 0, search: fold(i.title) })
    for (const a of (acc.get(i.id) ?? []).sort((x, y) => day(x).localeCompare(day(y)) || byName(x.title, y.title))) {
      out.push({ key: a.id, label: a.title, chip: a.title, meta: thingMeta(a), depth: 1, parent: i.id, search: fold(a.title) })
    }
  }
  return out
}

function storeOptions(items: readonly ShopItem[]): ScopeOption[] {
  return byStore(items).map(r => ({ key: r.key, label: r.title, chip: r.title, count: r.count, depth: 0 as const }))
}

/**
 * Things whose title has every word of the query — an item stays when one of
 * its accessories matches (it heads it), an accessory when its item matches.
 */
export function filterThingOptions(options: readonly ScopeOption[], query: string): ScopeOption[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return [...options]
  const hit = (o: ScopeOption) => words.every(w => (o.search ?? fold(o.label)).includes(w))
  const hits = new Set(options.filter(hit).map(o => o.key))
  const parents = new Set(options.filter(o => o.parent && hits.has(o.key)).map(o => o.parent as string))
  return options.filter(o => hits.has(o.key) || parents.has(o.key) || (!!o.parent && hits.has(o.parent)))
}

export const SECTION_WORD: Record<ScopeSection, string> = { categories: 'Category', chains: 'Chain', things: 'Thing', stores: 'Store' }

export interface ScopeChip { section: ScopeSection; key: string; word: string; label: string }

/** The picks as chips, section by section in the sheet's order (a pick no longer offered reads "Not found"). */
export function scopeChips(scope: StatsScope, options: ScopeOptions): ScopeChip[] {
  const sections: ScopeSection[] = ['categories', 'chains', 'things', 'stores']
  return sections.flatMap(section => scope[section].map(key => ({
    section, key, word: SECTION_WORD[section], label: options[section].find(o => o.key === key)?.chip ?? 'Not found',
  })))
}
