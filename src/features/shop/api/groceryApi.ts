import { supabase } from '../../../integrations/supabase/client'
import type { GroceryHit, GroceryPrice } from '../groceryModel'

// Kassalapp through the `food-search` edge function (the personal key stays
// server-side). Two Shop modes: find a product to match a quick-list row, and
// price every matched row at each chain in ONE call (Kassalapp's bulk prices,
// ≤ 100 EANs) — its free plan allows 60 calls a minute.

/** Products for a quick-list row: one per EAN, with a picture and one shop's price. */
export async function searchGroceries(query: string): Promise<GroceryHit[]> {
  const q = query.trim()
  if (!q) return []
  const { data, error } = await supabase.functions.invoke('food-search', { body: { mode: 'grocery_search', search: q } })
  if (error) throw error
  if (data?.error === 'not_configured') throw new Error('Grocery prices need the Kassalapp key on the server (KASSALAPP_API_KEY).')
  if (data?.error) throw new Error('Kassalapp did not answer — try again in a moment.')
  return (data?.products ?? []) as GroceryHit[]
}

/** Each EAN's current price at every chain Kassalapp follows. An older function without the mode answers nothing. */
export async function fetchGroceryPrices(eans: readonly string[]): Promise<GroceryPrice[]> {
  const list = [...new Set(eans)].filter(Boolean).slice(0, 100)
  if (!list.length) return []
  const { data, error } = await supabase.functions.invoke('food-search', { body: { mode: 'grocery_prices', eans: list } })
  if (error) throw error
  if (data?.error === 'not_configured') throw new Error('Grocery prices need the Kassalapp key on the server (KASSALAPP_API_KEY).')
  if (data?.error) throw new Error('Kassalapp did not answer — try again in a moment.')
  if (!Array.isArray(data?.prices)) throw new Error('Redeploy the food-search function to get grocery prices.')
  return data.prices as GroceryPrice[]
}
