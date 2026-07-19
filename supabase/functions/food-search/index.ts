// food-search — proxies Kassalapp (kassal.app) so the API token stays
// server-side (KASSALAPP_API_KEY in Vault, never in the client). Returns
// Norwegian grocery products normalized to the app's per-100g BarcodeProduct
// shape. If the key isn't set it returns an empty list (the client falls back
// to Open Food Facts), so it's safe to deploy before the secret exists.
//
// Response STRUCTURE verified from the kassalappy Python client's Pydantic
// models (github.com/bendikrb/kassalappy): the search/ean endpoints return
// { data: Product | Product[] } where
//   Product = { name, brand, image, ean, current_price, nutrition: NutritionItem[] }
//   NutritionItem = { code: str, display_name: str, amount: float, unit: str }
// So `normalize()` reads nutrition[].{display_name/code, amount, unit} — that
// part is CONFIRMED. What remains to verify against ONE live sample: the exact
// display_name/code VALUES (assumed Norwegian: Energi/Protein/Karbohydrater/
// Fett/Sukker(-arter)/Kostfiber) and that amounts are per 100g. Energy is
// disambiguated by unit (kcal vs kJ) so a kJ row can't be mistaken for kcal.
// Name-search results may omit nutrition (lighter projection) → macros null,
// the user fills/scans; the ean endpoint carries full nutrition.

const KASSAL = 'https://kassal.app/api/v1'

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 10) / 10 : null
  if (typeof v === 'string') { const n = Number(v.replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 10) / 10 : null }
  return null
}

// nutrition[] = { code, display_name, amount, unit } (verified). Probe a row by
// its display_name/code, return its amount.
function macro(nutrition: unknown, keys: string[]): number | null {
  if (!Array.isArray(nutrition)) return null
  const row = nutrition.find((n: Record<string, unknown>) => {
    const label = String(n?.display_name ?? n?.code ?? '').toLowerCase()
    return keys.some(k => label.includes(k))
  }) as Record<string, unknown> | undefined
  return row ? toNum(row.amount) : null
}

// Energy is disambiguated by unit: a kcal row is used as-is; a kJ row is
// converted. Prevents mistaking a kJ "Energi" row for kcal.
function energyKcal(nutrition: unknown): number | null {
  if (!Array.isArray(nutrition)) return null
  const rows = nutrition.filter((n: Record<string, unknown>) =>
    /energi|energy|kcal|kj/i.test(String(n?.display_name ?? n?.code ?? '')))
  const isKcal = (n: Record<string, unknown>) => /kcal/i.test(String(n?.unit ?? '')) || /kcal/i.test(String(n?.display_name ?? n?.code ?? ''))
  const kcalRow = rows.find(isKcal)
  if (kcalRow) return toNum((kcalRow as Record<string, unknown>).amount)
  const kjRow = rows[0]
  const kj = kjRow ? toNum((kjRow as Record<string, unknown>).amount) : null
  return kj == null ? null : Math.round((kj / 4.184) * 10) / 10
}

function normalize(item: Record<string, unknown>) {
  const nutr = item.nutrition
  const calories = energyKcal(nutr)
  return {
    code: String(item.ean ?? item.gtin ?? '') || '',
    name: String(item.name ?? '').trim(),
    brand: (item.brand as string) ?? (item.vendor as string) ?? null,
    calories,
    protein_g: macro(nutr, ['protein']),
    carbs_g:   macro(nutr, ['karbohydra', 'carbohydr']),
    fat_g:     macro(nutr, ['fett', 'fat']),
    sugar_g:   macro(nutr, ['sukker', 'sugar']),
    fiber_g:   macro(nutr, ['fiber', 'kostfiber']),
    serving_label: null,
    serving_grams: null,
    image_url: (item.image as string) ?? null,
    source: 'kassalapp',
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const key = Deno.env.get('KASSALAPP_API_KEY')
  if (!key) return json({ products: [], note: 'KASSALAPP_API_KEY not set' })

  let body: { search?: string; ean?: string } = {}
  try { body = await req.json() } catch { /* empty */ }

  const url = body.ean
    ? `${KASSAL}/products/ean/${encodeURIComponent(String(body.ean).replace(/\D/g, ''))}`
    : `${KASSAL}/products?search=${encodeURIComponent(body.search ?? '')}&size=20`

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })
    if (!r.ok) return json({ products: [], error: `kassalapp ${r.status}` })
    const j = await r.json()
    const items = Array.isArray(j?.data) ? j.data : (j?.data ? [j.data] : [])
    const products = items.map(normalize).filter((p: { name: string }) => p.name)
    return json({ products })
  } catch (e) {
    return json({ products: [], error: String((e as Error).message ?? e) })
  }
})
