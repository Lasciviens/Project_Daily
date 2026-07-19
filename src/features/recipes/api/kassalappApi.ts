import { supabase } from '../../../integrations/supabase/client'
import type { BarcodeProduct } from './openFoodFactsApi'

// ─────────────────────────────────────────────────────────────────────────────
//  Kassalapp (kassal.app) — Norwegian grocery products (name + barcode + price
//  + nutrition). Needs a personal API token, so it's proxied by the
//  `food-search` edge function (KASSALAPP_API_KEY stays server-side, never in
//  the client). Returns the same per-100g BarcodeProduct shape as Open Food
//  Facts so the UI treats both identically.
// ─────────────────────────────────────────────────────────────────────────────

// We've committed to Kassalapp (token provisioned). If the edge function isn't
// deployed / the key is unset yet, searchBrandedFoods just errors and callers
// fall back to Open Food Facts — no crash.
export function isKassalappEnabled(): boolean {
  return true
}

export async function searchBrandedFoods(query: string): Promise<BarcodeProduct[]> {
  const q = query.trim()
  if (!q) return []
  const { data, error } = await supabase.functions.invoke('food-search', { body: { search: q } })
  if (error) throw error
  return (data?.products ?? []) as BarcodeProduct[]
}

export async function lookupBrandedBarcode(ean: string): Promise<BarcodeProduct | null> {
  const clean = ean.replace(/\D/g, '')
  if (!clean) return null
  const { data, error } = await supabase.functions.invoke('food-search', { body: { ean: clean } })
  if (error) throw error
  return (data?.products?.[0] ?? null) as BarcodeProduct | null
}
