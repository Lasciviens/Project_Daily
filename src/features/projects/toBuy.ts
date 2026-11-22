import { rowTitle, statusColumn, tableSettings, titleColumn } from './projectModel'
import type { CreateShopItemInput } from '../shop/types'
import type { ProjectBlock, ProjectEntry, TableSettings } from './types'

// A table's "To buy" rows as quick-list rows. Pure — scripts/verify-project-to-buy.cjs.
// A row is "to buy" when the table's first choice column holds a choice named
// "To buy" (any case). The shop row carries the name, the amount ("×2"), the
// row's own web address when it has one (https only, compared as built by
// `new URL`, never a prefix check) and the project's name in its notes —
// `shop_items` has no project column, so the note is the way back.

export const TO_BUY = 'to buy'

export interface ToBuyRow { entryId: string; title: string; quantity: number | null; url: string | null; data: Record<string, unknown> }

/** The table's "To buy" choice, if it has a choice column with one. */
function toBuyOption(settings: TableSettings): { key: string; option: string } | null {
  const col = statusColumn(settings)
  const option = col?.options?.find(o => o.trim().toLowerCase() === TO_BUY)
  return col && option ? { key: col.key, option } : null
}

/** The first column that looks like an amount: a number column named Qty / Quantity / Amount / Count. */
function quantityKey(settings: TableSettings): string | null {
  return settings.columns.find(c => c.type === 'number' && /^(qty|quantity|amount|count|pcs)$/i.test(c.label.trim()))?.key ?? null
}

/** A web address only when it is https (or http) and parses to the same text. */
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return null
  try {
    const u = new URL(value)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.toString() : null
  } catch { return null }
}

/** The rows of a table block that are marked "To buy", in the table's order. */
export function toBuyRows(block: Pick<ProjectBlock, 'kind' | 'settings'>, rows: readonly ProjectEntry[]): ToBuyRow[] {
  if (block.kind !== 'table') return []
  const settings = tableSettings(block.settings)
  const want = toBuyOption(settings)
  if (!want || !titleColumn(settings)) return []
  const qtyKey = quantityKey(settings)
  const linkKey = settings.columns.find(c => c.type === 'link')?.key ?? null
  return [...rows]
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .filter(r => r.data[want.key] === want.option)
    .map(r => {
      const q = qtyKey ? r.data[qtyKey] : null
      return {
        entryId: r.id,
        title: rowTitle(settings, r.data).slice(0, 200),
        quantity: typeof q === 'number' && Number.isFinite(q) && q > 0 ? q : null,
        url: linkKey ? safeWebUrl(r.data[linkKey]) : null,
        data: r.data,
      }
    })
    .filter(r => r.title !== 'Untitled')
}

/** One quick-list row: "×2 · for Kitchen scale". */
export function toShopInput(row: ToBuyRow, projectName: string): CreateShopItemInput {
  return {
    title: row.title,
    notes: [row.quantity != null ? `×${row.quantity}` : null, `for ${projectName}`].filter(Boolean).join(' · '),
    url: row.url,
    list: 'quick',
    source_type: 'manual',
  }
}

/**
 * Sent rows move from "To buy" to "Ordered" (so a second tap finds nothing to
 * send): the choice column's key and both choices as the table spells them;
 * null when the table has no "Ordered" choice — its rows then stay as they are.
 */
export function sentChoice(block: Pick<ProjectBlock, 'settings'>): { key: string; from: string; to: string } | null {
  const settings = tableSettings(block.settings)
  const want = toBuyOption(settings)
  const col = statusColumn(settings)
  const to = col?.options?.find(o => o.trim().toLowerCase() === 'ordered')
  return want && to ? { key: want.key, from: want.option, to } : null
}

/** A row's data after it is sent. */
export function sentData(row: Pick<ToBuyRow, 'data'>, c: { key: string; to: string }): Record<string, unknown> {
  return { ...row.data, [c.key]: c.to }
}
