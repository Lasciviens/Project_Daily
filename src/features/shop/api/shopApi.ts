import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { defaultCurrencyFor } from '../shopModel'
import type {
  ShopCategory, ShopItem, ShopItemCost, ShopItemLink, ShopPricePoint, ShopPriceWatch,
  CreateShopCategoryInput, CreateShopCostInput, CreateShopItemInput, ShopCurrency, ShopDisposal, UpdateShopItemInput,
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

// ─── Before the migrations ────────────────────────────────────────────────────

// Migration 134 added list / currency / bought_at / task_id and made
// category_id optional; 137 added what you own, general wishes, accessories,
// deals and the sale facts. Before one is applied, a write that only carries
// its defaults retries without its columns; one that needs them says which
// migration instead of silently saving something else.
type Row = Record<string, unknown>
const COLUMNS_134 = ['list', 'currency', 'bought_at', 'task_id'] as const
const COLUMNS_137 = [
  'kind', 'price_min', 'price_max', 'requirements', 'option_for', 'meets', 'accessory_of', 'reason', 'wait_for_deal',
  'target_price', 'deal_note', 'errand', 'image_url', 'ean', 'fx_nok', 'fx_source', 'market_price', 'market_currency',
  'used', 'got_as_gift', 'for_resale', 'kept', 'approx_dates', 'serial', 'warranty_until', 'return_by', 'value_now',
  'value_currency', 'value_on', 'disposal', 'disposed_on', 'sale_price', 'sale_currency', 'sale_fx_nok',
  'sale_fx_source', 'sold_to', 'sale_group',
] as const
/** 137's columns at their defaults — a row carrying only these needs nothing new. */
const DEFAULTS_137: Row = { kind: 'item', wait_for_deal: false, errand: false, used: false, got_as_gift: false, for_resale: false, kept: true, approx_dates: false }

const NEEDS_134 = 'This needs migration 134 (Shop lists) — apply supabase/migrations/134_shop_lists.sql first.'
const NEEDS_137 = 'This needs migration 137 (Shop: what you own) — apply supabase/migrations/137_shop_owned.sql first.'
const NEEDS_138 = 'Naming a chain needs migration 138 — apply supabase/migrations/138_shop_chain_names.sql first.'

/** True for an "apply migration 134/137 first" refusal, so a caller can fall back. */
export function needsShopMigration(err: unknown): boolean {
  return err instanceof Error && (err.message === NEEDS_134 || err.message === NEEDS_137)
}

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204'
    || /column .* does not exist|could not find the '.*' column/i.test(error.message ?? '')
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist|could not find the table/i.test(error.message ?? '')
}

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message ?? '')
}

/** Which migration a missing-column error is about (by the column it names; unknown → both). */
function missingGroup(error: { message?: string }): '134' | '137' {
  const m = /'(\w+)' column|column (?:\w+\.)?"?(\w+)"? does not exist/i.exec(error.message ?? '')
  const col = m?.[1] ?? m?.[2] ?? ''
  return (COLUMNS_137 as readonly string[]).includes(col) ? '137' : '134'
}

function needs137(row: Row): boolean {
  return (COLUMNS_137 as readonly string[]).some(k => k in row && row[k] != null && (k in DEFAULTS_137 ? row[k] !== DEFAULTS_137[k] : true))
    || row.status === 'fulfilled'
}

function without(row: Row, columns: readonly string[]): Row {
  const copy = { ...row }
  for (const k of columns) delete copy[k]
  return copy
}

/**
 * Runs a write; on a missing column, retries once per migration without that
 * migration's columns — unless the write needs them (`needs134` decides for
 * 134; any non-default 137 value needs 137).
 */
async function writeWithFallback<T>(row: Row, needs134: (row: Row) => boolean, write: (row: Row) => PromiseLike<{ data: T | null; error: { code?: string; message?: string } | null }>): Promise<T | null> {
  let current = row
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await write(current)
    if (!error) return data
    if (!isMissingColumn(error)) throw error
    if ('chain_name' in current) throw new Error(NEEDS_138)
    if (needs137(current)) throw new Error(NEEDS_137)
    if (missingGroup(error) === '137' && attempt === 0) { current = without(current, COLUMNS_137); continue }
    if (needs134(current)) throw new Error(NEEDS_134)
    current = without(without(current, COLUMNS_137), COLUMNS_134)
  }
  throw new Error(NEEDS_134)
}

// ─── Items ────────────────────────────────────────────────────────────────────

// PostgREST returns at most 1,000 rows per request, and the quick list keeps
// every ticked errand as a row (Buy again counts them), so read every page —
// a silent cut would drop the OLDEST rows first: long-standing wishlist items.
const PAGE = 1000

export async function fetchShopItems(): Promise<ShopItem[]> {
  const rows: ShopItem[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('shop_items')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

const needs134Insert = (row: Row) => row.list === 'quick' || !row.category_id || row.currency === 'EUR' || row.currency === 'USD'
const needs134Update = (patch: Row) => patch.list === 'quick' || patch.bought_at != null || patch.task_id != null
  || patch.currency === 'EUR' || patch.currency === 'USD' || ('category_id' in patch && patch.category_id == null)

export async function createShopItem(input: CreateShopItemInput): Promise<ShopItem> {
  const user = await requireUser()
  const { title, price, region, ...rest } = input
  const row: Row = {
    ...rest,
    user_id:      user.id,
    category_id:  input.category_id ?? null,
    title,
    notes:        input.notes ?? null,
    price:        price ?? null,
    price_source: input.price_source ?? (price != null ? 'manual' : null),
    platform:     input.platform ?? null,
    url:          input.url ?? null,
    priority:     input.priority ?? 'medium',
    region:       region ?? null,
    planned_date: input.planned_date ?? null,
    source_type:  input.source_type ?? 'manual',
    list:         input.list ?? 'wishlist',
    currency:     price != null ? input.currency ?? defaultCurrencyFor(region) : input.currency ?? null,
  }
  const data = await writeWithFallback<ShopItem>(row, needs134Insert, r => supabase.from('shop_items').insert(r).select().single())
  return data as ShopItem
}

export async function updateShopItem(id: string, patch: UpdateShopItemInput): Promise<void> {
  await writeWithFallback(patch as Row, needs134Update, r => supabase.from('shop_items').update(r).eq('id', id))
}

/** Everything a delete takes with it, to put back exactly (migration 137's shop_delete_items). */
export interface ShopSnapshot {
  items: ShopItem[]
  links: ShopItemLink[]
  costs: ShopItemCost[]
  /** Children of the deleted rows (accessories, models) whose parent pointer the delete cleared. */
  children: { id: string; accessory_of: string | null; option_for: string | null }[]
}

/** Deletes the rows and returns what an Undo needs (before 137: the rows alone). */
export async function deleteShopItems(ids: string[]): Promise<ShopSnapshot> {
  const empty: ShopSnapshot = { items: [], links: [], costs: [], children: [] }
  if (!ids.length) return empty
  const rpc = await supabase.rpc('shop_delete_items', { p_ids: ids })
  if (!rpc.error) return { ...empty, ...(rpc.data as Partial<ShopSnapshot>) }
  if (!isMissingFunction(rpc.error)) throw rpc.error
  const { data, error } = await supabase.from('shop_items').delete().in('id', ids).select()
  if (error) throw error
  return { ...empty, items: data ?? [] }
}

/** Put deleted rows back exactly as they were, with their links, costs and children (the Undo after a delete). */
export async function restoreShopItems(snapshot: ShopSnapshot): Promise<void> {
  if (!snapshot.items.length) return
  const rpc = await supabase.rpc('shop_restore_items', { p_snapshot: snapshot })
  if (!rpc.error) return
  if (!isMissingFunction(rpc.error)) throw rpc.error
  for (const r of snapshot.items) {
    await writeWithFallback(r as unknown as Row, () => false, row => supabase.from('shop_items').insert(row))
  }
}

// ─── Selling ──────────────────────────────────────────────────────────────────

export interface SaleInput {
  /** The thing first, then the accessories sold with it — each with its share of the money (null = not known). */
  rows: { id: string; sale_price: number | null }[]
  disposal: ShopDisposal
  /** yyyy-mm-dd */
  on: string
  currency: ShopCurrency
  soldTo: string | null
  /** Accessories kept: moved onto another thing, or (null) standing on their own. */
  keep: { id: string; move_to: string | null }[]
  /** Where the money goes (a thing or a wish), and how much of it (null = all). */
  to: string | null
  toAmount: number | null
}

/** One sale with its accessories, the kept ones moved or detached, and where the money went — one transaction. */
export async function recordSale(input: SaleInput): Promise<void> {
  const { error } = await supabase.rpc('shop_record_sale', {
    p_rows: input.rows, p_disposal: input.disposal, p_on: input.on, p_currency: input.currency,
    p_sold_to: input.soldTo, p_keep: input.keep, p_to: input.to, p_to_amount: input.toAmount,
  })
  if (error) throw isMissingFunction(error) ? new Error(NEEDS_137) : error
}

/** The thing (and everything sold with it) is yours again; its links stay as plans. */
export async function undoSale(id: string): Promise<void> {
  const { error } = await supabase.rpc('shop_undo_sale', { p_id: id })
  if (error) throw isMissingFunction(error) ? new Error(NEEDS_137) : error
}

// ─── Money links ──────────────────────────────────────────────────────────────

export async function fetchShopLinks(): Promise<ShopItemLink[]> {
  const { data, error } = await supabase.from('shop_item_links').select('*').order('created_at', { ascending: true })
  if (error) { if (isMissingTable(error)) return []; throw error }
  return (data ?? []).map(l => ({ ...l, amount: l.amount == null ? null : Number(l.amount) }))
}

export async function createShopLink(input: { from_id: string; to_id: string; amount?: number | null }): Promise<void> {
  const { error } = await supabase.from('shop_item_links').upsert(
    { from_id: input.from_id, to_id: input.to_id, amount: input.amount ?? null },
    { onConflict: 'from_id,to_id' },
  )
  if (error) throw isMissingTable(error) ? new Error(NEEDS_137) : error
}

export async function deleteShopLink(id: string): Promise<void> {
  const { error } = await supabase.from('shop_item_links').delete().eq('id', id)
  if (error) throw error
}

// ─── Extra costs ──────────────────────────────────────────────────────────────

export async function fetchShopCosts(): Promise<ShopItemCost[]> {
  const { data, error } = await supabase.from('shop_item_costs').select('*').order('spent_on', { ascending: true })
  if (error) { if (isMissingTable(error)) return []; throw error }
  return (data ?? []).map(c => ({ ...c, amount: Number(c.amount), fx_nok: c.fx_nok == null ? null : Number(c.fx_nok) }))
}

export async function createShopCost(input: CreateShopCostInput): Promise<ShopItemCost> {
  const { data, error } = await supabase.from('shop_item_costs').insert({
    item_id: input.item_id, label: input.label, amount: input.amount, currency: input.currency ?? 'NOK',
    ...(input.spent_on ? { spent_on: input.spent_on } : {}),
    ...(input.fx_nok != null ? { fx_nok: input.fx_nok } : {}),
  }).select().single()
  if (error) throw isMissingTable(error) ? new Error(NEEDS_137) : error
  return data
}

export async function updateShopCost(id: string, patch: Partial<Pick<ShopItemCost, 'label' | 'amount' | 'currency' | 'spent_on' | 'fx_nok'>>): Promise<void> {
  const { error } = await supabase.from('shop_item_costs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteShopCost(id: string): Promise<ShopItemCost | null> {
  const { data, error } = await supabase.from('shop_item_costs').delete().eq('id', id).select().maybeSingle()
  if (error) throw error
  return data
}

export async function restoreShopCost(row: ShopItemCost): Promise<void> {
  const { error } = await supabase.from('shop_item_costs').insert(row)
  if (error) throw error
}

// ─── The price watch ──────────────────────────────────────────────────────────

export async function fetchPriceWatches(): Promise<ShopPriceWatch[]> {
  const { data, error } = await supabase.from('shop_price_watch').select('*')
  if (error) { if (isMissingTable(error)) return []; throw error }
  const num = (v: unknown) => (v == null ? null : Number(v))
  return (data ?? []).map(w => ({ ...w, low: num(w.low), high: num(w.high), was: num(w.was), prev_low: num(w.prev_low) }))
}

/** One row's price history, oldest first (two years at most — the function trims older points). */
export async function fetchPricePoints(itemId: string): Promise<ShopPricePoint[]> {
  const { data, error } = await supabase.from('shop_price_points').select('*').eq('item_id', itemId).order('checked_at', { ascending: true }).limit(800)
  if (error) { if (isMissingTable(error)) return []; throw error }
  return (data ?? []).map(p => ({ ...p, low: Number(p.low), high: p.high == null ? null : Number(p.high) }))
}
