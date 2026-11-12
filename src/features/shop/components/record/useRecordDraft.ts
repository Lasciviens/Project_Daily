import { useState } from 'react'
import { middayIso } from '../../../media/watchedWhen'
import { localDay, type CategoryPick } from '../../shopModel'
import type { ShopItem, UpdateShopItemInput } from '../../types'

/**
 * A record's edits before Save: only what changed, on top of the live row. `new_top` / `new_sub`: the names typed
 * for "+ New category…", made on Save — never columns.
 */
export type RecordDraft = Partial<ShopItem> & { bought_day?: string; new_top?: string; new_sub?: string }

/** Draft keys that are never a column. */
const DRAFT_ONLY = new Set(['bought_day', 'new_top', 'new_sub'])

/** The category picker's "+ New category…" / "+ New subcategory…" value (the add sheet's way). */
export const NEW_CATEGORY = '__new__'
const NEW_PICK = 'new:'

/** A pick with "+ New category…" in it, as the draft's category id until Save makes it: "new:" + top + "\n" + sub. */
export const newCategoryId = (p: CategoryPick): string | null =>
  p.topId === NEW_CATEGORY || p.subId === NEW_CATEGORY ? `${NEW_PICK}${p.topId}\n${p.subId}` : null
export const isNewCategory = (id: string | null | undefined): id is string => !!id && id.startsWith(NEW_PICK)
export function newPickOf(id: string): CategoryPick {
  const [topId = '', subId = ''] = id.slice(NEW_PICK.length).split('\n')
  return { topId, subId }
}

/** The name a new category still needs before Save (the add sheet's Save waits for it too), else null. */
export function newCategoryMissing(draft: RecordDraft): 'top' | 'sub' | null {
  if (!isNewCategory(draft.category_id)) return null
  const p = newPickOf(draft.category_id)
  if (p.topId === NEW_CATEGORY && !draft.new_top?.trim()) return 'top'
  if (p.subId === NEW_CATEGORY && !draft.new_sub?.trim()) return 'sub'
  return null
}

/** `open`: the fact whose editor shows first (an old "Could sell for"'s "update it"). */
export function useRecordDraft(item: ShopItem, open: string | null = null) {
  const [draft, setDraft] = useState<RecordDraft>({})
  const [editing, setEditing] = useState<string | null>(open)
  /** The value shown: the edit when there is one, else the row's. */
  const value = <K extends keyof ShopItem>(k: K): ShopItem[K] => (k in draft ? (draft as ShopItem)[k] : item[k])
  const boughtDay = draft.bought_day ?? (item.bought_at ? localDay(item.bought_at) : '')
  const set = (patch: RecordDraft) => setDraft(d => ({ ...d, ...patch }))
  const dirty = Object.keys(draft).some(k => k === 'bought_day'
    ? draft.bought_day !== (item.bought_at ? localDay(item.bought_at) : '')
    : !DRAFT_ONLY.has(k) && (draft as Record<string, unknown>)[k] !== (item as unknown as Record<string, unknown>)[k])
  const discard = () => { setDraft({}); setEditing(null) }
  return { draft, value, boughtDay, set, dirty, discard, editing, setEditing }
}

/** The patch a Save sends: changed columns only; a typed price is the owner's own. */
export function patchOf(item: ShopItem, draft: RecordDraft): UpdateShopItemInput {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(draft)) {
    if (DRAFT_ONLY.has(k)) continue
    if (v !== (item as unknown as Record<string, unknown>)[k]) patch[k] = v
  }
  if (draft.bought_day && draft.bought_day !== (item.bought_at ? localDay(item.bought_at) : '')) patch.bought_at = middayIso(draft.bought_day)
  if ('price' in patch) patch.price_source = patch.price != null ? 'manual' : null
  // A "Could sell for" typed now is dated today unless a day came with it.
  if ('value_now' in patch && !('value_on' in patch)) patch.value_on = patch.value_now == null ? null : localDay(new Date().toISOString())
  if ('value_now' in patch && patch.value_now != null && !item.value_currency && !('value_currency' in patch)) patch.value_currency = 'NOK'
  return patch as UpdateShopItemInput
}
