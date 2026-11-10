import { supabase } from '../../../integrations/supabase/client'
import { groceryHitOf, scanEan, type GroceryHit, type GroceryPrice } from '../groceryModel'

// Kassalapp through the `food-search` edge function (the personal key stays
// server-side). Three Shop modes: find a product to match a quick-list row,
// look a scanned barcode up, and price every matched row at each chain in ONE
// call (Kassalapp's bulk prices, ≤ 100 EANs) — its free plan allows 60 calls
// a minute. Every product is checked where it enters (`groceryHitOf`).

const NOT_CONFIGURED = 'Grocery prices need the Kassalapp key on the server (KASSALAPP_API_KEY).'
const NO_ANSWER = 'Kassalapp did not answer — try again in a moment.'

/** Products for a quick-list row: one per EAN, with a picture and one shop's price. */
export async function searchGroceries(query: string): Promise<GroceryHit[]> {
  const q = query.trim()
  if (!q) return []
  const { data, error } = await supabase.functions.invoke('food-search', { body: { mode: 'grocery_search', search: q } })
  if (error) throw error
  if (data?.error === 'not_configured') throw new Error(NOT_CONFIGURED)
  if (data?.error) throw new Error(NO_ANSWER)
  const rows: unknown[] = Array.isArray(data?.products) ? data.products : []
  return rows.map(groceryHitOf).filter((h): h is GroceryHit => h != null)
}

/**
 * The product a scanned barcode is (Kassalapp's `/products/ean/{ean}`), or
 * null when Kassalapp doesn't know it. Only an EAN of 8–14 digits is asked;
 * an older function without the mode is told apart by the mode it answers.
 */
export async function lookUpGroceryEan(code: string): Promise<GroceryHit | null> {
  const ean = scanEan(code)
  if (!ean) return null
  const { data, error } = await supabase.functions.invoke('food-search', { body: { mode: 'grocery_ean', ean } })
  if (error) throw error
  if (data?.error === 'not_configured') throw new Error(NOT_CONFIGURED)
  if (data?.error) throw new Error(NO_ANSWER)
  if (data?.mode !== 'grocery_ean') throw new Error('Redeploy the food-search function to look up barcodes.')
  const rows: unknown[] = Array.isArray(data.products) ? data.products : []
  return rows.map(groceryHitOf).find((h): h is GroceryHit => h != null) ?? null
}

/** Each EAN's last price at every chain that lists it, old ones too (groceryModel leaves those out). An older function without the mode answers nothing. */
export async function fetchGroceryPrices(eans: readonly string[]): Promise<GroceryPrice[]> {
  const list = [...new Set(eans)].filter(Boolean).slice(0, 100)
  if (!list.length) return []
  const { data, error } = await supabase.functions.invoke('food-search', { body: { mode: 'grocery_prices', eans: list } })
  if (error) throw error
  if (data?.error === 'not_configured') throw new Error(NOT_CONFIGURED)
  if (data?.error) throw new Error(NO_ANSWER)
  if (!Array.isArray(data?.prices)) throw new Error('Redeploy the food-search function to get grocery prices.')
  return data.prices as GroceryPrice[]
}
