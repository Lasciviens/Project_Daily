import { supabase } from '../../../integrations/supabase/client'
import { requireUser } from '../../../shared/utils/requireUser'
import { isDay, parseDealDay } from '../dealDays'
import { parsePriceStats, priceStatsBatches } from '../priceStats'
import { isShopSignal, parseSignalState, parseSignalWrite, SIGNATURE_RE, SUBJECT_RE } from '../signalStates'
import { allPages } from './shopApi'
import type { ShopDealDay, ShopPriceStats, ShopSignal, ShopSignalState, ShopSignalStateFields, ShopSignalWrite } from '../types'

// Needs a look's data (migration 190): what the owner did with its rows (shop_signal_states, written through
// three functions that answer the row before and after, so an Undo puts back exactly what was there), the deal
// days (shop_deal_days, read only), and the price figures of many things in one call (shop_price_stats). Every
// answer is checked where it enters (signalStates, dealDays, priceStats).
//
// Before 190 is applied (a failed migration, a revert) the reads answer nothing and a write says so by name.
// Remove those fallbacks once 190 has run everywhere.

type PgError = { code?: string; message?: string }
const missingTable = (e: PgError) => e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? '')
const missingFunction = (e: PgError) => e.code === '42883' || e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '')

/** A write before migration 190 is applied. */
export const NEEDS_190 = 'Needs a look can\'t remember this yet — migration 190 is not applied'

const nonNull = <T>(x: T | null): x is T => x !== null

/** A Needs-a-look row: one thing (null = the whole page, the tidy-up), its signal and its subject (a deal day's slug). */
export interface SignalKey { item_id: string | null; signal: ShopSignal; subject?: string | null }
export interface SnoozeSignalInput extends SignalKey { /** yyyy-mm-dd: the row comes back on this day. */ until: string }
export interface DismissSignalInput extends SignalKey { /** signalStates.signalSignature of what the row says now. */ signature: string }
export interface PutSignalInput extends SignalKey { /** The state to write back exactly; null = none (the row goes). */ state: ShopSignalStateFields | null }

function checkKey(k: SignalKey): void {
  if (!isShopSignal(k.signal)) throw new Error('Not a Needs-a-look signal')
  if (k.subject != null && !SUBJECT_RE.test(k.subject)) throw new Error('Not a Needs-a-look subject')
}

/** The key's own arguments: the subject only when there is one (each function's p_subject defaults to none). */
const keyArgs = (k: SignalKey) => ({ p_item_id: k.item_id, p_signal: k.signal, ...(k.subject ? { p_subject: k.subject } : {}) })

async function write(fn: 'shop_signal_snooze' | 'shop_signal_dismiss' | 'shop_signal_put', args: Record<string, unknown>): Promise<ShopSignalWrite> {
  await requireUser()
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw missingFunction(error) ? new Error(NEEDS_190) : error
  return parseSignalWrite(data)
}

/** Every row the owner snoozed or said Got it to (the caller's own: row level security and the owner lock). */
export async function fetchSignalStates(): Promise<ShopSignalState[]> {
  try {
    const rows = await allPages<unknown>((from, to) => supabase
      .from('shop_signal_states')
      .select('*')
      .order('id', { ascending: true })
      .range(from, to))
    return rows.map(parseSignalState).filter(nonNull)
  } catch (e) {
    if (missingTable(e as PgError)) return []
    throw e
  }
}

/** Snooze: the row stays away until `until` (an earlier Got it stays). */
export async function snoozeSignal(input: SnoozeSignalInput): Promise<ShopSignalWrite> {
  checkKey(input)
  if (!isDay(input.until)) throw new Error('Snoozing needs a day')
  return write('shop_signal_snooze', { ...keyArgs(input), p_until: input.until })
}

/** Got it: the row stays away while its signature is this one (a snooze ends). */
export async function dismissSignal(input: DismissSignalInput): Promise<ShopSignalWrite> {
  checkKey(input)
  if (typeof input.signature !== 'string' || !SIGNATURE_RE.test(input.signature)) throw new Error('This row can\'t be remembered — its signature is not one the database takes')
  return write('shop_signal_dismiss', { ...keyArgs(input), p_signature: input.signature })
}

/** Writes a state back exactly (an Undo), or none (`state` null: the row goes). */
export async function putSignalState(input: PutSignalInput): Promise<ShopSignalWrite> {
  checkKey(input)
  const s = input.state
  const state = s && { id: s.id, created_at: s.created_at, signature: s.signature, snoozed_until: s.snoozed_until, dismissed_at: s.dismissed_at }
  return write('shop_signal_put', { ...keyArgs(input), p_state: state })
}

/** Show again: the row's state goes (its answer's `before` is what an Undo puts back). */
export function clearSignalState(key: SignalKey): Promise<ShopSignalWrite> {
  return putSignalState({ ...key, state: null })
}

/** The deal days, each a whole rule (dealDays.dealsAhead gives their next runs). */
export async function fetchDealDays(): Promise<ShopDealDay[]> {
  try {
    const rows = await allPages<unknown>((from, to) => supabase
      .from('shop_deal_days')
      .select('*')
      .order('slug', { ascending: true })
      .range(from, to))
    return rows.map(parseDealDay).filter(nonNull)
  } catch (e) {
    if (missingTable(e as PgError)) return []
    throw e
  }
}

/**
 * The price figures of the caller's things among `itemIds`, from their clean history — one call per 500 ids
 * (one in practice), never one per thing. A thing with no clean read, or not the caller's, has no answer.
 */
export async function fetchPriceStats(itemIds: readonly string[]): Promise<ShopPriceStats[]> {
  const out: ShopPriceStats[] = []
  for (const batch of priceStatsBatches(itemIds)) {
    const { data, error } = await supabase.rpc('shop_price_stats', { p_item_ids: batch })
    if (error) {
      if (missingFunction(error)) return out
      throw error
    }
    for (const row of (Array.isArray(data) ? data : []) as unknown[]) {
      const s = parsePriceStats(row)
      if (s) out.push(s)
    }
  }
  return out
}
