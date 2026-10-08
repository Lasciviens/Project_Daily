// Accessories under the thing they belong to, in every drill-down list.
// Pure — scripts/verify-shop-owned.cjs.
import type { ShopItem } from '../../types'
import type { DrillRow } from './drillTypes'

/**
 * The same rows with each accessory moved under its item (depth 1), right
 * after the item's first row. When the item has no row of its own in the
 * list, a heading row for it (no amount, so a group's total is unchanged)
 * takes the place of its first accessory, and its accessories follow it.
 * Every row stays exactly once, the rest in their order.
 */
export function nestAccessories(rows: readonly DrillRow[], byId: ReadonlyMap<string, ShopItem>): DrillRow[] {
  const parentOf = (r: DrillRow): string | null => {
    if (r.header) return null
    const p = byId.get(r.id)?.accessory_of
    return p && p !== r.id && byId.has(p) ? p : null
  }
  const children = new Map<string, DrillRow[]>()
  for (const r of rows) {
    const p = parentOf(r)
    if (p) children.set(p, [...(children.get(p) ?? []), r])
  }
  if (!children.size) return [...rows]
  const owned = new Set(rows.filter(r => !parentOf(r)).map(r => r.id))
  const placed = new Set<string>()
  const nested = (p: string) => (children.get(p) ?? []).map(c => ({ ...c, depth: 1 as const }))
  const out: DrillRow[] = []
  for (const r of rows) {
    const p = parentOf(r)
    if (!p) {
      out.push(r)
      if (children.has(r.id) && !placed.has(r.id)) { placed.add(r.id); out.push(...nested(r.id)) }
    } else if (!owned.has(p) && !placed.has(p)) {
      placed.add(p)
      const kids = children.get(p) ?? []
      out.push({ key: `nest:${p}`, id: p, title: byId.get(p)?.title ?? '', sub: kids.length === 1 ? 'Accessory below' : 'Accessories below', header: true })
      out.push(...nested(p))
    }
  }
  return out
}
