import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { defaultCurrencyFor } from '../shopModel'
import { draftRows, type ChainDraft, type Copied } from '../chainDraft'
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

// ─── Every page of a read ─────────────────────────────────────────────────────

// PostgREST returns at most 1,000 rows per request, and a silent cut drops
// rows: the quick list keeps every ticked errand as a row (Buy again counts
// them), so long-standing wishlist items went first. Every open-ended read
// takes page after page in one total order (`id` last, so no row sits on two
// pages) until a page comes back short.
const PAGE = 1000

async function allPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) return rows
  }
}

// ─── Items ────────────────────────────────────────────────────────────────────

export async function fetchShopItems(): Promise<ShopItem[]> {
  return allPages<ShopItem>((from, to) => supabase
    .from('shop_items')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to))
}

export async function createShopItem(input: CreateShopItemInput): Promise<ShopItem> {
  const user = await requireUser()
  const { title, price, region, ...rest } = input
  const { data, error } = await supabase
    .from('shop_items')
    .insert({
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
    })
    .select()
    .single()
  if (error) throw error
  return data as ShopItem
}

// ─── Daily's Shopping card ────────────────────────────────────────────────────

/**
 * The columns Daily's Shopping card reads: what it shows (title, region) and
 * every column shopModel's quickDue / quickFromWishlist look at
 * (scripts/verify-shop-api.cjs fails when the rules read one more).
 */
export const QUICK_ROW_COLUMNS = [
  'id', 'title', 'region', 'list', 'status', 'priority', 'kind', 'option_for', 'errand', 'wait_for_deal', 'platform', 'planned_date', 'created_at',
] as const
export type ShopQuickRow = Pick<ShopItem, typeof QUICK_ROW_COLUMNS[number]>

/**
 * Every row the quick list may ask to pick up: still to buy, and on the quick
 * list, an errand or waiting for a deal. Which of them, and in what order, is
 * the Shop page's own rule (useQuickToPickUp); this read only leaves out the
 * rest — everything bought, ticked or dropped, and every other wish.
 */
export async function fetchQuickRows(): Promise<ShopQuickRow[]> {
  return allPages<ShopQuickRow>((from, to) => supabase
    .from('shop_items')
    .select(QUICK_ROW_COLUMNS.join(', '))
    .eq('status', 'wishlist')
    .or('list.eq.quick,errand.is.true,wait_for_deal.is.true')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to)
    .overrideTypes<ShopQuickRow[], { merge: false }>())
}

// ─── Changing and deleting ────────────────────────────────────────────────────

/** The row as stored after the change (the database's rules fill the rest); one that isn't there is an error, never a silent no-op. */
export async function updateShopItem(id: string, patch: UpdateShopItemInput): Promise<ShopItem> {
  const user = await requireUser()
  const { data, error } = await supabase
    .from('shop_items')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
  if (error) throw error
  if (!data?.length) throw new Error('Not saved — this item is not there any more.')
  return data[0] as ShopItem
}

/**
 * Everything a delete takes with it, to put back exactly (shop_delete_items,
 * migration 187). The Undo hands it back unchanged — the price watch, its
 * history and rows of later tables ride along as they came.
 */
export interface ShopSnapshot {
  items: ShopItem[]
  links: ShopItemLink[]
  costs: ShopItemCost[]
  /** Children of the deleted rows (accessories, models) whose parent pointer the delete cleared. */
  children: { id: string; accessory_of: string | null; option_for: string | null }[]
  watches?: unknown[]
  points?: unknown[]
  more?: unknown[]
}

/** Deletes the rows and returns what an Undo needs (one call, under the caller's own row level security). */
export async function deleteShopItems(ids: string[]): Promise<ShopSnapshot> {
  const empty: ShopSnapshot = { items: [], links: [], costs: [], children: [] }
  if (!ids.length) return empty
  const { data, error } = await supabase.rpc('shop_delete_items', { p_ids: ids })
  if (error) throw error
  return { ...empty, ...(data as Partial<ShopSnapshot>) }
}

/** Put deleted rows back exactly as they were, with their links, costs, children and price history (the Undo after a delete). */
export async function restoreShopItems(snapshot: ShopSnapshot): Promise<void> {
  if (!snapshot.items.length) return
  const { error } = await supabase.rpc('shop_restore_items', { p_snapshot: snapshot })
  if (error) throw error
}

// ─── A whole chain at once ────────────────────────────────────────────────────

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** A new id for a draft row (it becomes the row's id on save). */
export const newShopId = newUuid

/**
 * Saves a chain built in the app — every thing with its accessories and sale
 * facts, and the "Paid with money from" links — in ONE call: shop_restore_items
 * puts the rows in, then their parents (an accessory's item, a model's wish),
 * then the links, in a single transaction under the caller's own row-level
 * security. The before-trigger fills each day's rate and checks the days, the
 * link trigger checks the links; if anything is refused, nothing is left
 * behind. (The function was written for Delete's Undo; a chain is the same
 * shape: rows with known ids plus their links.)
 */
export async function saveShopChain(draft: ChainDraft, base: Copied | null, today: string): Promise<void> {
  const user = await requireUser()
  const rows = draftRows(draft, base, { mode: 'save', userId: user.id, nowIso: new Date().toISOString(), today, newId: newUuid })
  const { error } = await supabase.rpc('shop_restore_items', { p_snapshot: { items: rows.items, links: rows.links, costs: [], children: [] } })
  if (error) throw error
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
  if (error) throw error
}

/** The thing (and everything sold with it) is yours again; the accessories the sale moved and its money link go back as they were. */
export async function undoSale(id: string): Promise<void> {
  const { error } = await supabase.rpc('shop_undo_sale', { p_id: id })
  if (error) throw error
}

// ─── Money links ──────────────────────────────────────────────────────────────

export async function fetchShopLinks(): Promise<ShopItemLink[]> {
  const rows = await allPages<ShopItemLink>((from, to) => supabase
    .from('shop_item_links')
    .select('*')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to))
  return rows.map(l => ({ ...l, amount: l.amount == null ? null : Number(l.amount) }))
}

export async function createShopLink(input: { from_id: string; to_id: string; amount?: number | null }): Promise<void> {
  const { error } = await supabase.from('shop_item_links').upsert(
    { from_id: input.from_id, to_id: input.to_id, amount: input.amount ?? null },
    { onConflict: 'from_id,to_id' },
  )
  if (error) throw error
}

// ─── Extra costs ──────────────────────────────────────────────────────────────

export async function fetchShopCosts(): Promise<ShopItemCost[]> {
  const rows = await allPages<ShopItemCost>((from, to) => supabase
    .from('shop_item_costs')
    .select('*')
    .order('spent_on', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to))
  return rows.map(c => ({ ...c, amount: Number(c.amount), fx_nok: c.fx_nok == null ? null : Number(c.fx_nok) }))
}

export async function createShopCost(input: CreateShopCostInput): Promise<ShopItemCost> {
  const { data, error } = await supabase.from('shop_item_costs').insert({
    item_id: input.item_id, label: input.label, amount: input.amount, currency: input.currency ?? 'NOK',
    ...(input.spent_on ? { spent_on: input.spent_on } : {}),
    ...(input.fx_nok != null ? { fx_nok: input.fx_nok } : {}),
  }).select().single()
  if (error) throw error
  return data
}

// ─── The price watch ──────────────────────────────────────────────────────────

export async function fetchPriceWatches(): Promise<ShopPriceWatch[]> {
  const rows = await allPages<ShopPriceWatch>((from, to) => supabase
    .from('shop_price_watch')
    .select('*')
    .order('item_id', { ascending: true })
    .range(from, to))
  const num = (v: unknown) => (v == null ? null : Number(v))
  return rows.map(w => ({ ...w, low: num(w.low), high: num(w.high), was: num(w.was), prev_low: num(w.prev_low), used_low: num(w.used_low), refurbished_low: num(w.refurbished_low) }))
}

/** How many of a row's latest price reads its history shows (two years of daily checks fit). */
const POINTS_SHOWN = 800

/** One row's price history, oldest first: its newest reads, so the line always reaches the last check (the function keeps two years). */
export async function fetchPricePoints(itemId: string): Promise<ShopPricePoint[]> {
  const { data, error } = await supabase
    .from('shop_price_points')
    .select('*')
    .eq('item_id', itemId)
    .order('checked_at', { ascending: false })
    .limit(POINTS_SHOWN)
  if (error) throw error
  return (data ?? []).reverse().map(p => ({
    ...p, low: Number(p.low), high: p.high == null ? null : Number(p.high),
    used_low: p.used_low == null ? null : Number(p.used_low), refurbished_low: p.refurbished_low == null ? null : Number(p.refurbished_low),
  }))
}
