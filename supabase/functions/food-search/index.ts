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

// nutrition[] = { code, display_name, amount, unit } (verified live, per 100g).
// Real codes: energi_kcal, energi_kj, protein, karbohydrater, fett_totalt,
// mettet_fett/enumettet_fett/flerumettet_fett, sukkerarter, kostfiber, salt.
// Match by EXACT code first (so fett_totalt ≠ mettet_fett), display-name
// substring as a resilient fallback (with an exclude list).
type NRow = Record<string, unknown>
function pick(nutrition: unknown, codes: string[], subs: string[], exclude: string[] = []): number | null {
  if (!Array.isArray(nutrition)) return null
  let row = (nutrition as NRow[]).find(n => codes.includes(String(n?.code ?? '').toLowerCase()))
  if (!row) row = (nutrition as NRow[]).find(n => {
    const label = String(n?.display_name ?? n?.code ?? '').toLowerCase()
    return subs.some(s => label.includes(s)) && !exclude.some(x => label.includes(x))
  })
  return row ? toNum(row.amount) : null
}

// Energy → kcal. Prefer the energi_kcal / kcal-unit row; convert a kJ row only
// if that's all there is.
function energyKcal(nutrition: unknown): number | null {
  if (!Array.isArray(nutrition)) return null
  const rows = nutrition as NRow[]
  const kcal = rows.find(n => String(n?.code ?? '').toLowerCase() === 'energi_kcal' || /kcal/i.test(String(n?.unit ?? '')))
  if (kcal) return toNum(kcal.amount)
  const kj = rows.find(n => String(n?.code ?? '').toLowerCase() === 'energi_kj' || /kj/i.test(String(n?.unit ?? '')))
  const v = kj ? toNum(kj.amount) : null
  return v == null ? null : Math.round((v / 4.184) * 10) / 10
}

function normalize(item: Record<string, unknown>) {
  const nutr = item.nutrition
  return {
    code: String(item.ean ?? item.gtin ?? '') || '',
    name: String(item.name ?? '').trim(),
    brand: (item.brand as string) ?? (item.vendor as string) ?? null,
    calories:  energyKcal(nutr),
    protein_g: pick(nutr, ['protein'], ['protein']),
    carbs_g:   pick(nutr, ['karbohydrater'], ['karbohydr', 'carbohydr']),
    fat_g:     pick(nutr, ['fett_totalt'], ['fett', 'fat'], ['mettet', 'umettet', 'saturat']),
    sugar_g:   pick(nutr, ['sukkerarter'], ['sukker', 'sugar']),
    fiber_g:   pick(nutr, ['kostfiber', 'fiber'], ['fiber', 'kostfiber']),
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
