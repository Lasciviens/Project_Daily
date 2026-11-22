import { supabase } from '../../../integrations/supabase/client'
import { createShopItem, deleteShopItems, allPages } from './shopApi'
import { foldedTitles, splitNew } from '../quickBatch'
import type { CreateShopItemInput, ShopItem } from '../types'

// Several rows onto the quick list in one go. The rows already on the list are
// read fresh at the moment of the add (a cached list can be minutes old), so a
// double tap or a second device never adds a thing twice.

/** Titles of the open quick-list rows (still to buy). */
async function fetchQuickTitles(): Promise<string[]> {
  const rows = await allPages<{ title: string }>((from, to) => supabase
    .from('shop_items')
    .select('title')
    .eq('list', 'quick')
    .eq('status', 'wishlist')
    .order('id', { ascending: true })
    .range(from, to)
    .overrideTypes<{ title: string }[], { merge: false }>())
  return rows.map(r => r.title)
}

export interface QuickBatchResult { added: ShopItem[]; skipped: number }

/** Adds the rows that are not on the list yet. A row that fails stops the add, and the ones already made are taken off again. */
export async function addBatchToQuickList(wanted: readonly CreateShopItemInput[]): Promise<QuickBatchResult> {
  const { fresh, skipped } = splitNew(wanted, foldedTitles(await fetchQuickTitles()))
  const added: ShopItem[] = []
  try {
    for (const input of fresh) added.push(await createShopItem({ ...input, list: 'quick', source_type: 'manual' }))
  } catch (err) {
    if (added.length) await deleteShopItems(added.map(r => r.id)).catch(() => undefined)
    throw err
  }
  return { added, skipped: skipped.length }
}

/** Takes a batch off again (the Undo): rows made a moment ago have nothing hanging on them. */
export async function removeBatch(rows: readonly ShopItem[]): Promise<void> {
  await deleteShopItems(rows.map(r => r.id))
}
