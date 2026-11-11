import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { addDays, isDay } from '../dealDays'
import {
  AD_LANGUAGES, isAdUrl, isCondition, isCurrency, isHost, isPrice, linkOnHost, MAX_CHECKLIST_STEPS, MAX_LISTING_PRICE, normalizeAdUrl,
  parseAdNote, parseAdTemplate, parseChecklist, parseListing, parseTradeInQuote, parseValuePoint, pricesProblem,
} from '../resaleRows'
import { allPages } from './shopApi'
import type {
  CreateAdNoteInput, CreateAdTemplateInput, CreateChecklistInput, CreateListingInput, CreateTradeInQuoteInput, ListingPrice,
  ShopAdNote, ShopAdTemplate, ShopHandoverChecklist, ShopListing, ShopTradeInQuote, ShopValuePoint, UpdateAdNoteInput,
  UpdateAdTemplateInput, UpdateChecklistInput, UpdateListingInput, UpdateTradeInQuoteInput,
} from '../resaleTypes'

// Resale and selling (migration 192): ad notes, trade-in quotes, the value history (read only: the database keeps
// it from "Could sell for"), listings, ad templates and hand-over checklists. What the owner typed is checked here
// before it is sent (resaleRows — the same rules as 192's), and every row the database answers is checked where it
// enters. Every write is the caller's own rows (`user_id`, and row level security). An ad's link is never fetched.
//
// Before 192 is applied (a failed migration, a revert) the reads answer nothing and a write says so by name.
// Remove those fallbacks once 192 has run everywhere.

type PgError = { code?: string; message?: string }
const missingTable = (e: PgError) => e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? '')
const missingFunction = (e: PgError) => e.code === '42883' || e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '')

/** A write before migration 192 is applied. */
export const NEEDS_192 = 'Selling can\'t save this yet — migration 192 is not applied'
/** A write whose answer this app can't read back (a newer database). */
const UNREADABLE = 'Saved, but the answer can\'t be read here — reload the page'

const nonNull = <T>(x: T | null): x is T => x !== null

async function readAll<T>(table: string, order: [string, boolean][], parse: (row: unknown) => T | null): Promise<T[]> {
  try {
    const rows = await allPages<unknown>((from, to) => {
      let q = supabase.from(table).select('*')
      for (const [col, ascending] of order) q = q.order(col, { ascending })
      return q.order('id', { ascending: true }).range(from, to)
    })
    return rows.map(parse).filter(nonNull)
  } catch (e) {
    if (missingTable(e as PgError)) return []
    throw e
  }
}

const fail = (e: PgError): Error => (missingTable(e) || missingFunction(e) ? new Error(NEEDS_192) : (e as Error))

async function insertRow<T>(table: string, row: Record<string, unknown>, parse: (row: unknown) => T | null): Promise<T> {
  const user = await requireUser()
  const { data, error } = await supabase.from(table).insert({ ...row, user_id: user.id }).select().single()
  if (error) throw fail(error)
  const out = parse(data)
  if (!out) throw new Error(UNREADABLE)
  return out
}

async function updateRow<T>(table: string, id: string, patch: Record<string, unknown>, parse: (row: unknown) => T | null): Promise<T> {
  const user = await requireUser()
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).eq('user_id', user.id).select()
  if (error) throw fail(error)
  if (!data?.length) throw new Error('Not saved — it is not there any more.')
  const out = parse(data[0])
  if (!out) throw new Error(UNREADABLE)
  return out
}

/** Only the fields a patch names (an absent one is left as it is; null clears it). */
const named = (patch: Record<string, unknown>) => Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))

const trimmed = (s: string | null | undefined) => (s == null ? s : s.trim())

// ── Checks of what the owner typed (the same as 192's) ───────────────────────

/** A pasted ad link as it is stored (normalizeAdUrl: as the URL parser writes it), or a plain refusal. */
function adLink(raw: string): string {
  const link = normalizeAdUrl(raw)
  if (link === null) throw new Error('An ad\'s link is one https:// address (paste it from the address bar)')
  return link
}

/** An optional link: none for null or blank, else as stored. */
const optionalAdLink = (raw: string | null | undefined): string | null => (raw?.trim() ? adLink(raw) : null)

function checkLink(adUrl: string | null | undefined, marketplace: string | null | undefined): void {
  if (adUrl != null && !isAdUrl(adUrl)) throw new Error('An ad\'s link is one https:// address (paste it from the address bar)')
  if (marketplace != null && !isHost(marketplace)) throw new Error('A marketplace is its web address, like finn.no')
  if (adUrl != null && marketplace != null && !linkOnHost(adUrl, marketplace)) throw new Error(`The ad's link is not on ${marketplace}`)
}

function checkMoney(amount: number | undefined, currency: string | undefined, what: string): void {
  if (amount !== undefined && !isPrice(amount)) throw new Error(`${what} is an amount from 0 below a billion`)
  if (currency !== undefined && !isCurrency(currency)) throw new Error('The currency is NOK, TRY, EUR or USD')
}

function checkDay(day: string | null | undefined, what: string): void {
  if (day != null && !isDay(day)) throw new Error(`${what} is a day`)
}

function checkCondition(c: string | null | undefined): void {
  if (c != null && !isCondition(c)) throw new Error('Not a condition this app knows')
}

// ── Ad notes ─────────────────────────────────────────────────────────────────

/** Every ad noted, newest first. */
export function fetchAdNotes(): Promise<ShopAdNote[]> {
  return readAll('shop_ad_notes', [['noted_on', false]], parseAdNote)
}

/** "+ Note an ad": a link (https, never fetched) and its price. */
export async function createAdNote(input: CreateAdNoteInput): Promise<ShopAdNote> {
  const adUrl = adLink(input.ad_url), marketplace = trimmed(input.marketplace)?.toLowerCase() || null
  checkLink(adUrl, marketplace)
  checkMoney(input.price, input.currency, 'The price')
  checkCondition(input.condition)
  checkDay(input.noted_on, 'The day noted')
  return insertRow('shop_ad_notes', named({
    item_id: input.item_id, ad_url: adUrl, price: input.price, currency: input.currency, marketplace,
    condition: input.condition ?? null, asking: input.asking, noted_on: input.noted_on,
  }), parseAdNote)
}

export async function updateAdNote(id: string, patch: UpdateAdNoteInput, current: Pick<ShopAdNote, 'ad_url' | 'marketplace'>): Promise<ShopAdNote> {
  const adUrl = patch.ad_url === undefined ? undefined : adLink(patch.ad_url)
  const marketplace = patch.marketplace === undefined ? undefined : trimmed(patch.marketplace)?.toLowerCase() || null
  checkLink(adUrl ?? current.ad_url, marketplace === undefined ? current.marketplace : marketplace)
  checkMoney(patch.price, patch.currency, 'The price')
  checkCondition(patch.condition)
  checkDay(patch.noted_on, 'The day noted')
  return updateRow('shop_ad_notes', id, named({ ...patch, ad_url: adUrl, marketplace }), parseAdNote)
}

// ── Trade-in quotes ──────────────────────────────────────────────────────────

/** Every trade-in quote, newest first. */
export function fetchTradeInQuotes(): Promise<ShopTradeInQuote[]> {
  return readAll('shop_trade_in_quotes', [['quoted_on', false]], parseTradeInQuote)
}

function checkQuote(dealer: string | undefined, note: string | null | undefined): void {
  if (dealer !== undefined && (!dealer || dealer.length > 120)) throw new Error('Who offered it? (up to 120 characters)')
  if (note != null && note.length > 500) throw new Error('A note is up to 500 characters')
}

export async function createTradeInQuote(input: CreateTradeInQuoteInput): Promise<ShopTradeInQuote> {
  const dealer = input.dealer.trim(), note = trimmed(input.note) || null
  checkQuote(dealer, note)
  checkMoney(input.amount, input.currency, 'The amount')
  checkCondition(input.condition)
  checkDay(input.quoted_on, 'The day of the quote')
  return insertRow('shop_trade_in_quotes', named({
    item_id: input.item_id, dealer, amount: input.amount, currency: input.currency, condition: input.condition ?? null,
    quoted_on: input.quoted_on, note,
  }), parseTradeInQuote)
}

export async function updateTradeInQuote(id: string, patch: UpdateTradeInQuoteInput): Promise<ShopTradeInQuote> {
  const dealer = patch.dealer === undefined ? undefined : patch.dealer.trim()
  const note = patch.note === undefined ? undefined : trimmed(patch.note) || null
  checkQuote(dealer, note)
  checkMoney(patch.amount, patch.currency, 'The amount')
  checkCondition(patch.condition)
  checkDay(patch.quoted_on, 'The day of the quote')
  return updateRow('shop_trade_in_quotes', id, named({ ...patch, dealer, note }), parseTradeInQuote)
}

// ── The value history ────────────────────────────────────────────────────────

/** Every "Could sell for" with its day (the database keeps it), by thing, oldest first. */
export function fetchValueHistory(): Promise<ShopValuePoint[]> {
  return readAll('shop_value_history', [['item_id', true], ['valued_on', true]], parseValuePoint)
}

// ── Listings ─────────────────────────────────────────────────────────────────

/** Every listing, newest first. */
export function fetchListings(): Promise<ShopListing[]> {
  return readAll('shop_listings', [['listed_on', false]], parseListing)
}

function checkPrices(prices: readonly ListingPrice[], listedOn: string, today: string): void {
  const problem = pricesProblem(prices, listedOn, addDays(today, 1))
  if (problem) throw new Error(problem)
}

/** A thing listed (the ad written) or for sale (the ad up), at its asking price from `listed_on` (today by default). */
export async function createListing(input: CreateListingInput, today: string): Promise<ShopListing> {
  const listedOn = input.listed_on ?? today
  const marketplace = trimmed(input.marketplace)?.toLowerCase() || null
  const adUrl = optionalAdLink(input.ad_url)
  checkDay(listedOn, 'The day it was listed')
  checkLink(adUrl, marketplace)
  checkMoney(input.price, input.currency, 'The asking price')
  if (input.price >= MAX_LISTING_PRICE) throw new Error('The asking price is below a billion')
  if (input.status !== undefined && input.status !== 'listed' && input.status !== 'for_sale') throw new Error('A listing starts listed or for sale')
  if (input.ad_text != null && input.ad_text.length > 6000) throw new Error('An ad is up to 6 000 characters')
  const prices = [{ on: listedOn, price: input.price }]
  checkPrices(prices, listedOn, today)
  return insertRow('shop_listings', named({
    item_id: input.item_id, listed_on: listedOn, prices, currency: input.currency, marketplace, ad_url: adUrl,
    ad_text: input.ad_text ?? null, status: input.status ?? 'listed',
  }), parseListing)
}

/**
 * A listing changed by hand: up for sale, taken down, back to listed, a price change (a new price story), its
 * marketplace, link or text. Sold is never written here — it comes from recording the sale.
 */
export async function updateListing(current: Pick<ShopListing, 'id' | 'listed_on' | 'ad_url' | 'marketplace'>, patch: UpdateListingInput, today: string): Promise<ShopListing> {
  const status = patch.status as string | undefined
  if (status !== undefined && status !== 'listed' && status !== 'for_sale' && status !== 'withdrawn') {
    throw new Error('Sold comes from recording the sale (Sell or give away)')
  }
  const marketplace = patch.marketplace === undefined ? undefined : trimmed(patch.marketplace)?.toLowerCase() || null
  const adUrl = patch.ad_url === undefined ? undefined : optionalAdLink(patch.ad_url)
  checkLink(adUrl === undefined ? current.ad_url : adUrl, marketplace === undefined ? current.marketplace : marketplace)
  checkDay(patch.listed_on, 'The day it was listed')
  checkDay(patch.for_sale_on, 'The day it went up')
  checkDay(patch.ended_on, 'The day it ended')
  checkMoney(undefined, patch.currency, 'The price')
  if (patch.ad_text != null && patch.ad_text.length > 6000) throw new Error('An ad is up to 6 000 characters')
  if (patch.prices) checkPrices(patch.prices, patch.listed_on ?? current.listed_on, today)
  return updateRow('shop_listings', current.id, named({ ...patch, marketplace, ad_url: adUrl }), parseListing)
}

// ── Ad templates and hand-over checklists ────────────────────────────────────

/** The owner's ad templates (seeded in Norwegian by 192). */
export function fetchAdTemplates(): Promise<ShopAdTemplate[]> {
  return readAll('shop_ad_templates', [['created_at', true]], parseAdTemplate)
}

function checkTemplate(t: UpdateAdTemplateInput): void {
  if (t.title !== undefined && (!t.title.trim() || t.title.length > 200)) throw new Error('A title is 1–200 characters')
  if (t.body !== undefined && (!t.body.trim() || t.body.length > 5000)) throw new Error('A text is 1–5 000 characters')
  if (t.language !== undefined && !AD_LANGUAGES.includes(t.language)) throw new Error('A template is in Norwegian (nb) or English (en)')
  if (t.category != null && (!t.category.trim() || t.category.trim().length > 80)) throw new Error('A category name is 1–80 characters')
  if (t.marketplace != null && !isHost(t.marketplace)) throw new Error('A marketplace is its web address, like finn.no')
}

export async function createAdTemplate(input: CreateAdTemplateInput): Promise<ShopAdTemplate> {
  const row = { ...input, marketplace: trimmed(input.marketplace)?.toLowerCase() || null, category: trimmed(input.category) || null }
  checkTemplate(row)
  return insertRow('shop_ad_templates', named(row), parseAdTemplate)
}

export async function updateAdTemplate(id: string, patch: UpdateAdTemplateInput): Promise<ShopAdTemplate> {
  const row = {
    ...patch,
    marketplace: patch.marketplace === undefined ? undefined : trimmed(patch.marketplace)?.toLowerCase() || null,
    category: patch.category === undefined ? undefined : trimmed(patch.category) || null,
  }
  checkTemplate(row)
  return updateRow('shop_ad_templates', id, named(row), parseAdTemplate)
}

/** The owner's hand-over checklists (seeded by 192 for phones, game consoles and computers). */
export function fetchChecklists(): Promise<ShopHandoverChecklist[]> {
  return readAll('shop_handover_checklists', [['created_at', true]], parseChecklist)
}

function checkChecklist(c: UpdateChecklistInput): void {
  if (c.category !== undefined && (!c.category.trim() || c.category.trim().length > 80)) throw new Error('A category name is 1–80 characters')
  if (c.steps !== undefined) {
    if (!c.steps.trim() || c.steps.length > 4000) throw new Error('A checklist is 1–4 000 characters')
    if (c.steps.split('\n').length > MAX_CHECKLIST_STEPS) throw new Error(`A checklist has at most ${MAX_CHECKLIST_STEPS} steps`)
  }
}

export async function createChecklist(input: CreateChecklistInput): Promise<ShopHandoverChecklist> {
  const row = { category: input.category.trim(), steps: input.steps.replace(/\r\n?/g, '\n') }
  checkChecklist(row)
  return insertRow('shop_handover_checklists', row, parseChecklist)
}

export async function updateChecklist(id: string, patch: UpdateChecklistInput): Promise<ShopHandoverChecklist> {
  const row = named({ category: patch.category?.trim(), steps: patch.steps?.replace(/\r\n?/g, '\n') })
  checkChecklist(row)
  return updateRow('shop_handover_checklists', id, row, parseChecklist)
}

/** Puts back the default templates and checklists the owner has none of (never over one they have); how many. */
export async function addResaleDefaults(): Promise<number> {
  await requireUser()
  const { data, error } = await supabase.rpc('shop_add_resale_defaults')
  if (error) throw fail(error)
  const n = typeof data === 'number' ? data : Number(data)
  return Number.isInteger(n) && n >= 0 ? n : 0
}
