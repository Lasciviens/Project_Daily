import { useState } from 'react'
import { middayIso } from '../../../media/watchedWhen'
import { localDay } from '../../shopModel'
import type { ShopItem, UpdateShopItemInput } from '../../types'

/** A record's edits before Save: only what changed, on top of the live row. */
export type RecordDraft = Partial<ShopItem> & { bought_day?: string }

export function useRecordDraft(item: ShopItem) {
  const [draft, setDraft] = useState<RecordDraft>({})
  const [editing, setEditing] = useState<string | null>(null)
  /** The value shown: the edit when there is one, else the row's. */
  const value = <K extends keyof ShopItem>(k: K): ShopItem[K] => (k in draft ? (draft as ShopItem)[k] : item[k])
  const boughtDay = draft.bought_day ?? (item.bought_at ? localDay(item.bought_at) : '')
  const set = (patch: RecordDraft) => setDraft(d => ({ ...d, ...patch }))
  const dirty = Object.keys(draft).some(k => k === 'bought_day'
    ? draft.bought_day !== (item.bought_at ? localDay(item.bought_at) : '')
    : (draft as Record<string, unknown>)[k] !== (item as unknown as Record<string, unknown>)[k])
  const discard = () => { setDraft({}); setEditing(null) }
  return { draft, value, boughtDay, set, dirty, discard, editing, setEditing }
}

/** The patch a Save sends: changed columns only; a typed price is the owner's own. */
export function patchOf(item: ShopItem, draft: RecordDraft): UpdateShopItemInput {
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(draft)) {
    if (k === 'bought_day') continue
    if (v !== (item as unknown as Record<string, unknown>)[k]) patch[k] = v
  }
  if (draft.bought_day && draft.bought_day !== (item.bought_at ? localDay(item.bought_at) : '')) patch.bought_at = middayIso(draft.bought_day)
  if ('price' in patch) patch.price_source = patch.price != null ? 'manual' : null
  // A "Could sell for" typed now is dated today unless a day came with it.
  if ('value_now' in patch && !('value_on' in patch)) patch.value_on = patch.value_now == null ? null : localDay(new Date().toISOString())
  if ('value_now' in patch && patch.value_now != null && !item.value_currency && !('value_currency' in patch)) patch.value_currency = 'NOK'
  return patch as UpdateShopItemInput
}
