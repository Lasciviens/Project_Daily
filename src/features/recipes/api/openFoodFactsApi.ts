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
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null)

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
