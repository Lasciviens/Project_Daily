// What the add sheet keeps of its autofill's facts (autofillModel.ts): whether a fact is kept — a form fact only
// while its field still holds it — and what a save writes. Its own small module: the add sheet's save needs only
// this, and the rest of the autofill (the readers' rules, the history, the search links) loads with its panel.
// Pure — scripts/verify-shop-autofill.cjs runs it.
import type { Fact, FactFields, FactKey } from './autofillModel'
import type { ShopSavedFact } from './types'

/** The facts that are a field of the form too: the field holds the value, the fact says where it came from. */
export const FORM_FACTS: ReadonlySet<FactKey> = new Set<FactKey>(['title', 'price', 'image', 'store', 'category'])

/** Whether the form's field holds the fact's value now (a form fact the owner typed over is not used). */
export function fieldHolds(f: Fact, d: FactFields): boolean {
  switch (f.key) {
    case 'title': return d.title.trim() === f.value.trim()
    case 'price': return d.price === f.value.amount && d.currency === f.value.currency
    case 'image': return d.image === f.value
    case 'store': return d.platform.trim() === f.value
    case 'category': return d.topId === f.value.topId && d.subId === f.value.subId
    default: return f.on
  }
}

/** Whether a fact's row shows it kept: a form fact only while its field holds it. */
export function factKept(f: Fact, d: FactFields): boolean {
  return f.on && (!FORM_FACTS.has(f.key) || fieldHolds(f, d))
}

/** The facts as a row keeps them (shop_items.facts, a planned column): each its value, source, confidence and day. */
export type SavedFacts = Partial<Record<FactKey, ShopSavedFact>>

/**
 * What the add sheet saves of its facts: the EAN for its own column (`ean`), and every kept fact with its source
 * (`facts`) — a form fact only while its field still holds it (a value the owner typed over has no source to keep).
 * null when there is nothing to keep.
 */
export function factsToSave(facts: readonly Fact[], d: FactFields): { ean: string | null; facts: SavedFacts | null } {
  const kept = facts.filter(f => factKept(f, d))
  const out: SavedFacts = {}
  for (const f of kept) out[f.key] = { value: f.value, source: f.source.label, origin: f.source.origin, confidence: f.confidence, at: f.at }
  const ean = kept.find(f => f.key === 'ean')
  return { ean: ean ? ean.value as string : null, facts: kept.length ? out : null }
}
