// What the add sheet keeps of its autofill's facts (autofillModel.ts): whether a fact is kept — a form fact only
// while its field still holds it — and what a save writes (shop_items.facts in migration 191's shape). Its own
// small module: the add sheet's save needs only this, and the rest of the autofill (the readers' rules, the
// history, the search links) loads with its panel.
// Pure — scripts/verify-shop-autofill.cjs runs it.
import type { Fact, FactFields, FactKey } from './autofillModel'
import type { ShopFactKey, ShopItemFacts } from './types'

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

/** The facts a row keeps (191's allow-list), by the sheet's key: a form fact is its column, never a fact. */
const SAVED_AS: Partial<Record<FactKey, ShopFactKey>> = {
  brand: 'brand', model: 'model', ean: 'ean', condition: 'condition', returnDays: 'return_days', prisjaktId: 'prisjakt_id', specs: 'specs',
}

/** The facts as a row keeps them (shop_items.facts, 191): each exactly its value, source and confidence. */
export type SavedFacts = ShopItemFacts

/** 191's bounds: a source is one plain line of 1–200 characters; the whole object at most 8 KiB. */
const SOURCE_MAX = 200
const FACTS_MAX_BYTES = 8192

/** A source as 191 keeps it: one line, no control, zero-width or direction characters, ≤ 200 characters; '' = none. */
function plainSource(label: string): string {
  const flat = [...label].filter(ch => {
    const c = ch.codePointAt(0) as number
    return !(c < 0x20 || (c >= 0x7f && c <= 0x9f) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) || c === 0xfeff)
  }).join('').replace(/\s+/g, ' ').trim()
  return [...flat].slice(0, SOURCE_MAX).join('').trim()
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length

/**
 * What the add sheet saves of its facts: the EAN for its own column (`ean`), and every kept fact that 191 keeps,
 * with its source (`facts`) — the value the owner typed over has no source to keep. Spec rows are cut from the end
 * (then left out) until the whole fits 191's 8 KiB. null when there is nothing to keep.
 */
export function factsToSave(facts: readonly Fact[], d: FactFields): { ean: string | null; facts: SavedFacts | null } {
  const kept = facts.filter(f => factKept(f, d))
  const out: SavedFacts = {}
  for (const f of kept) {
    const key = SAVED_AS[f.key]
    const source = plainSource(f.source.label)
    if (!key || !source || f.value == null) continue
    out[key] = { value: f.value, source, confidence: f.confidence }
  }
  const specs = out.specs
  while (specs && Array.isArray(specs.value) && specs.value.length && bytes(out) > FACTS_MAX_BYTES) specs.value = specs.value.slice(0, -1)
  if (specs && (!Array.isArray(specs.value) || !specs.value.length || bytes(out) > FACTS_MAX_BYTES)) delete out.specs
  const ean = kept.find(f => f.key === 'ean')
  return { ean: ean ? ean.value as string : null, facts: Object.keys(out).length && bytes(out) <= FACTS_MAX_BYTES ? out : null }
}
