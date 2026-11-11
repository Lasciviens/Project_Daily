import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { createShopCost, NEEDS_191_ITEM } from './shopApi'
import type { ShopCurrency, ShopItem, ShopItemCost, UpdateShopItemInput } from '../types'

// A purchase's facts (Just bought, Arrived, the receipt note) and a marketplace search noted on a wish — the
// columns migration 191 adds to shop_items — and money got back as a rebate (a cost below 0). Each write answers
// the values before, so the toast's Undo writes them back exactly. Before 191 (a failed migration, a revert) a
// write of one of its columns says so by name (NEEDS_191_ITEM) — never a write that leaves part of it out.

/** The columns 191 adds; every other one a purchase writes is older. */
const NEW_191 = ['bought_channel', 'arrived_on', 'extra_warranty_until', 'receipt_note', 'search_opened_on'] as const

export type PurchasePatch = Pick<UpdateShopItemInput,
  'platform' | 'bought_at' | 'return_by' | 'warranty_until' | 'bought_channel' | 'arrived_on' | 'extra_warranty_until' | 'receipt_note' | 'search_opened_on'>

type PgError = { code?: string; message?: string }
const missingColumn = (e: PgError) => e.code === '42703' || e.code === 'PGRST204'

export interface PurchaseWrite {
  /** The written columns as they were (Undo writes them back). */
  before:  PurchasePatch
  after:   ShopItem
}

/** Write a purchase's facts; answers the values before (only the columns written) and the row after. */
export async function savePurchase(id: string, patch: PurchasePatch): Promise<PurchaseWrite> {
  const user = await requireUser()
  const { data: row, error } = await supabase.from('shop_items').select('*').eq('id', id).eq('user_id', user.id).maybeSingle()
  if (error) throw error
  if (!row) throw new Error('Not saved — this item is not there any more.')
  const keys = Object.keys(patch)
  const was = row as Record<string, unknown>
  const before = Object.fromEntries(keys.map(k => [k, was[k] ?? null])) as PurchasePatch
  const { data, error: writeError } = await supabase.from('shop_items').update(patch).eq('id', id).eq('user_id', user.id).select()
  if (writeError && missingColumn(writeError) && keys.some(k => (NEW_191 as readonly string[]).includes(k))) throw new Error(NEEDS_191_ITEM)
  if (writeError) throw writeError
  if (!data?.length) throw new Error('Not saved — this item is not there any more.')
  return { before, after: data[0] as ShopItem }
}

/** Money got back on a thing (a price protection, a price match, a refund of the difference): a rebate, a cost below 0. */
export async function addRebate(input: { itemId: string; amount: number; currency: ShopCurrency; label: string; on: string }): Promise<ShopItemCost> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('An amount above 0')
  return createShopCost({ item_id: input.itemId, label: input.label, amount: -Math.round(input.amount * 100) / 100, currency: input.currency, spent_on: input.on })
}

/** Takes a rebate just recorded away again (its Undo). */
export async function removeCost(id: string): Promise<void> {
  const user = await requireUser()
  const { error } = await supabase.from('shop_item_costs').delete().eq('id', id).eq('user_id', user.id)
  if (error) throw error
}
