import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import type {
  ShopCategory, ShopItem, CreateShopCategoryInput, CreateShopItemInput, UpdateShopItemInput,
} from '../types'

// ─── Categories ───────────────────────────────────────────────────────────────

export async function fetchShopCategories(): Promise<ShopCategory[]> {
  const { data, error } = await supabase
    .from('shop_categories')
    .select('*')
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createShopCategory(input: CreateShopCategoryInput): Promise<ShopCategory> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('shop_categories')
    .insert({ user_id: user.id, name: input.name, parent_id: input.parent_id ?? null })
    .select()
    .single()
  if (error) throw error
  return data
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function fetchShopItems(): Promise<ShopItem[]> {
  const { data, error } = await supabase
    .from('shop_items')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Migration 134 added list / currency / bought_at / task_id and made
// category_id optional. Before it is applied a write that only carries
// defaults retries without them; one that needs them (a quick-list row, a row
// without a category, a bought date, a linked task) says so instead of
// silently saving something else.
const NEW_COLUMNS = ['list', 'currency', 'bought_at', 'task_id'] as const

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204'
    || /column .* does not exist|could not find the '.*' column/i.test(error.message ?? '')
}

const NEEDS_134 = 'This needs migration 134 (Shop lists) — apply supabase/migrations/134_shop_lists.sql first.'

/** True for the "apply migration 134 first" refusal, so a caller can fall back. */
export function needsShopMigration(err: unknown): boolean {
  return err instanceof Error && err.message === NEEDS_134
}

function withoutNewColumns<T extends Record<string, unknown>>(row: T): T {
  const copy = { ...row }
  for (const k of NEW_COLUMNS) delete copy[k]
  return copy
}

export async function createShopItem(input: CreateShopItemInput): Promise<ShopItem> {
  const user = await requireUser()
  const row: Record<string, unknown> = {
    user_id:      user.id,
    category_id:  input.category_id ?? null,
    title:        input.title,
    notes:        input.notes ?? null,
    price:        input.price ?? null,
    price_source: input.price_source ?? (input.price != null ? 'manual' : null),
    platform:     input.platform ?? null,
    url:          input.url ?? null,
    priority:     input.priority ?? 'medium',
    region:       input.region ?? null,
    planned_date: input.planned_date ?? null,
    source_type:  input.source_type ?? 'manual',
    list:         input.list ?? 'wishlist',
    ...(input.price != null ? { currency: input.currency ?? (input.region === 'TR' ? 'TRY' : 'NOK') } : {}),
  }
  const first = await supabase.from('shop_items').insert(row).select().single()
  if (!first.error) return first.data
  if (!isMissingColumn(first.error)) throw first.error
  if (row.list === 'quick' || !row.category_id || row.currency === 'EUR' || row.currency === 'USD') {
    throw new Error(NEEDS_134)
  }
  const { data, error } = await supabase.from('shop_items').insert(withoutNewColumns(row)).select().single()
  if (error) throw error
  return data
}

export async function updateShopItem(id: string, patch: UpdateShopItemInput): Promise<void> {
  const { error } = await supabase.from('shop_items').update(patch).eq('id', id)
  if (!error) return
  if (!isMissingColumn(error)) throw error
  // Only a change that is about the new columns needs them; drop a derived
  // currency the form always sends, and refuse the rest by name.
  const needs = patch.list === 'quick' || patch.bought_at != null || patch.task_id != null
    || patch.currency === 'EUR' || patch.currency === 'USD'
  if (needs) throw new Error(NEEDS_134)
  const retry = await supabase.from('shop_items').update(withoutNewColumns(patch as Record<string, unknown>)).eq('id', id)
  if (retry.error) throw retry.error
}

/** Put deleted rows back exactly as they were (the Undo after a delete). */
export async function restoreShopItems(rows: ShopItem[]): Promise<void> {
  if (!rows.length) return
  const { error } = await supabase.from('shop_items').insert(rows)
  if (!error) return
  if (!isMissingColumn(error)) throw error
  const retry = await supabase.from('shop_items').insert(rows.map(r => withoutNewColumns(r as unknown as Record<string, unknown>)))
  if (retry.error) throw retry.error
}

/** Deletes and returns the rows, so the caller can offer Undo. */
export async function deleteShopItems(ids: string[]): Promise<ShopItem[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.from('shop_items').delete().in('id', ids).select()
  if (error) throw error
  return data ?? []
}
