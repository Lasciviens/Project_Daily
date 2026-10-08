import { supabase } from '../../../integrations/supabase/client'
import type { PriceRead } from '../priceRead'

// The `shop-price` edge function (migration 137): reads the price on a
// product link (a Prisjakt product page or a shop's own page) and fills the
// NOK rates purchases, sales and extra costs wait for. `read` previews a link
// before it is saved; `check` re-reads saved rows into the price watch; a
// daily cron does both for everything due.

export type PriceReadResult = PriceRead & { at: string; finalUrl: string }

function notDeployed(error: unknown): boolean {
  const msg = (error as { message?: string; context?: { status?: number } })?.message ?? ''
  const status = (error as { context?: { status?: number } })?.context?.status
  return status === 404 || /not found|Failed to send a request|FunctionsFetchError/i.test(msg)
}

const NOT_DEPLOYED = 'Price checks need the shop-price function — deploy it first (see the PR\'s steps).'

/** The price on a link right now; nothing is stored. Throws a plain sentence on failure. */
export async function readPriceLink(url: string): Promise<PriceReadResult> {
  const { data, error } = await supabase.functions.invoke('shop-price', { body: { action: 'read', url } })
  if (error) throw new Error(notDeployed(error) ? NOT_DEPLOYED : 'Could not check the price — try again in a moment.')
  if (data?.error) throw new Error(String(data.error))
  return data.result as PriceReadResult
}

export interface PriceCheckOutcome { id: string; status: 'ok' | 'no_price' | 'blocked' | 'error'; low: number | null; currency: string | null; error?: string }

/** Re-reads saved rows' links (≤ 10) into the price watch. */
export async function checkItemPrices(ids: readonly string[]): Promise<PriceCheckOutcome[]> {
  if (!ids.length) return []
  const { data, error } = await supabase.functions.invoke('shop-price', { body: { action: 'check', ids: ids.slice(0, 10) } })
  if (error) throw new Error(notDeployed(error) ? NOT_DEPLOYED : 'Could not check the prices — try again in a moment.')
  if (data?.error) throw new Error(String(data.error))
  return (data.results ?? []) as PriceCheckOutcome[]
}

export interface RatesOutcome { needed: number; filled: number; pending: number; error?: string }

/** Fetches Norges Bank's rates the caller's purchases, sales and costs wait for; the database fills them in. */
export async function fillRates(): Promise<RatesOutcome> {
  const { data, error } = await supabase.functions.invoke('shop-price', { body: { action: 'rates' } })
  if (error) throw new Error(notDeployed(error) ? NOT_DEPLOYED : 'Could not fetch the exchange rates — they are filled in tonight.')
  if (data?.error) throw new Error(String(data.error))
  return data.rates as RatesOutcome
}
