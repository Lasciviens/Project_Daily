// Open Food Facts barcode lookup — free, no key, CORS-open (verified:
// access-control-allow-origin: *), so the static GitHub Pages frontend can
// call it directly with no edge-function proxy/deploy. Returns per-100g macros
// shaped for recipe_ingredient_library (the library's canonical basis).

export interface BarcodeProduct {
  code:          string
  name:          string
  brand:         string | null
  calories:      number | null   // per 100g
  protein_g:     number | null
  carbs_g:       number | null
  fat_g:         number | null
  sugar_g:       number | null
  fiber_g:       number | null
  serving_label: string | null
  serving_grams: number | null
  image_url:     string | null   // product photo (image_front then generic)
  source?:       string          // 'openfoodfacts' | 'kassalapp' (set by the search source)
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)

// Map one OFF product object → our per-100g BarcodeProduct shape (shared by
// barcode lookup and name search).
function toProduct(p: Record<string, unknown>, fallbackCode = ''): BarcodeProduct {
  const n = (p.nutriments ?? {}) as Record<string, unknown>
  let calories = num(n['energy-kcal_100g'])
  if (calories == null && typeof n['energy_100g'] === 'number') calories = num((n['energy_100g'] as number) / 4.184)
  const name = (p.product_name_en as string) || (p.product_name as string) || (p.brands as string) || fallbackCode
  return {
    code: (p.code as string) || fallbackCode,
    name: String(name).trim(),
    brand: (p.brands as string) || null,
    calories,
    protein_g: num(n['proteins_100g']),
    carbs_g:   num(n['carbohydrates_100g']),
    fat_g:     num(n['fat_100g']),
    sugar_g:   num(n['sugars_100g']),
    fiber_g:   num(n['fiber_100g']),
    serving_label: (p.serving_size as string) || null,
    serving_grams: num(p.serving_quantity),
    image_url: (p.image_front_url as string) || (p.image_url as string) || null,
  }
}

// Name search (no barcode) — the PC/online path when you can't scan. OFF's
// search endpoint is CORS-open + no-key but heavily rate-limited (503s under
// load), so retry a couple of times and let the caller show a "busy" state.
// Returns per-100g products (many will have null macros — filter/keep as needed).
export async function searchFoodsByName(query: string): Promise<BarcodeProduct[]> {
  const q = query.trim()
  if (!q) return []
  const fields = 'code,product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,image_front_url,image_url'
  const url = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(q)}&fields=${fields}&page_size=20&sort_by=popularity_key`
  let lastStatus = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'LascisBoard/1.0 (personal food tracker)' } })
    lastStatus = res.status
    if (res.ok) {
      const json = await res.json() as { products?: Record<string, unknown>[] }
      return (json.products ?? [])
        .map(p => toProduct(p))
        .filter(p => p.name && p.calories != null)   // a food with no kcal is useless to log
        .slice(0, 15)
    }
    if (res.status !== 503 && res.status !== 429) break   // only retry the "busy" statuses
  }
  throw new Error(lastStatus === 503 || lastStatus === 429
    ? 'Open Food Facts is busy right now — try again in a moment'
    : `Food search failed (${lastStatus})`)
}

export async function lookupBarcode(code: string): Promise<BarcodeProduct | null> {
  const clean = code.replace(/\D/g, '')
  if (!clean) return null
  const fields = 'product_name,product_name_en,brands,nutriments,serving_size,serving_quantity,image_front_url,image_url'
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json?fields=${fields}`, {
    headers: { 'User-Agent': 'LascisBoard/1.0 (personal food tracker)' },
  })
  if (!res.ok) return null
  const json = await res.json() as { status?: number; product?: Record<string, unknown> }
  const p = json.product
  if (!p || json.status === 0) return null

  const n = (p.nutriments ?? {}) as Record<string, unknown>
  // Prefer kcal; fall back to kJ→kcal if only energy_100g (kJ) is present.
  let calories = num(n['energy-kcal_100g'])
  if (calories == null && typeof n['energy_100g'] === 'number') calories = num((n['energy_100g'] as number) / 4.184)

  const name = (p.product_name_en as string) || (p.product_name as string) || (p.brands as string) || clean
  const servingGrams = num(p.serving_quantity)

  return {
    code: clean,
    name: String(name).trim(),
    brand: (p.brands as string) || null,
    calories,
    protein_g: num(n['proteins_100g']),
    carbs_g:   num(n['carbohydrates_100g']),
    fat_g:     num(n['fat_100g']),
    sugar_g:   num(n['sugars_100g']),
    fiber_g:   num(n['fiber_100g']),
    serving_label: (p.serving_size as string) || null,
    serving_grams: servingGrams,
    image_url: (p.image_front_url as string) || (p.image_url as string) || null,
  }
}
