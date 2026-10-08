// A general wish ("a tablet with a pen, 5 000–8 000 NOK") and its models
// (migration 137): the requirements, each model's ✓ / ✗ / ? per requirement,
// and the best match. Pure — scripts/verify-shop-model.cjs.
import type { ShopItem } from './types'
import { fold, type Money } from './shopModel'

/** The wish's must-haves, one per line, blanks dropped. */
export function requirementsOf(wish: Pick<ShopItem, 'requirements'>): string[] {
  return (wish.requirements ?? '').split('\n').map(s => s.trim()).filter(Boolean)
}

/** A requirement's key in a model's `meets` (folded, so "Pen support" and "pen support " are one). */
export const reqKey = (text: string): string => fold(text).replace(/\s+/g, ' ')

/** ✓ (true), ✗ (false) or not known (undefined). */
export function meetsOf(model: Pick<ShopItem, 'meets'>, requirement: string): boolean | undefined {
  const v = model.meets?.[reqKey(requirement)]
  return typeof v === 'boolean' ? v : undefined
}

/** One tap cycles ? → ✓ → ✗ → ?; the result is the whole new `meets` object. */
export function cycleMeets(meets: Record<string, boolean> | null | undefined, requirement: string): Record<string, boolean> {
  const key = reqKey(requirement)
  const next = { ...(meets ?? {}) }
  const cur = next[key]
  if (cur === undefined) next[key] = true
  else if (cur) next[key] = false
  else delete next[key]
  return next
}

/** The models still in the running (not bought, not "Not chosen"). */
export const openModels = (models: readonly ShopItem[]) => models.filter(m => m.status === 'wishlist')

/**
 * The best match: every requirement it is known to answer is ✓ (none ✗), and
 * the lowest price now within the wish's range (any price when the wish has
 * no range; models without a price last). Null when no model qualifies.
 */
export function bestMatch(
  wish: ShopItem,
  models: readonly ShopItem[],
  priceNow: (m: ShopItem) => Money | null,
): ShopItem | null {
  const reqs = requirementsOf(wish)
  const lo = wish.price_min ?? -Infinity
  const hi = wish.price_max ?? Infinity
  const fits = openModels(models).filter(m => reqs.every(r => meetsOf(m, r) !== false))
  const priced = fits
    .map(m => ({ m, p: priceNow(m) }))
    .filter(x => !x.p || (x.p.amount >= lo && x.p.amount <= hi))
    .sort((a, b) => (a.p ? a.p.amount : Infinity) - (b.p ? b.p.amount : Infinity) || a.m.title.localeCompare(b.m.title))
  return priced[0]?.m ?? null
}

/** How many requirements a model is known to meet, of all. */
export function metCount(model: ShopItem, reqs: readonly string[]): { met: number; failed: number; unknown: number } {
  let met = 0, failed = 0, unknown = 0
  for (const r of reqs) {
    const v = meetsOf(model, r)
    if (v === true) met++
    else if (v === false) failed++
    else unknown++
  }
  return { met, failed, unknown }
}
