// food-search — proxies Kassalapp (kassal.app) so the API token stays
// server-side (KASSALAPP_API_KEY in Vault, never in the client). Returns
// Norwegian grocery products normalized to the app's per-100g BarcodeProduct
// shape. If the key isn't set it returns an empty list (the client falls back
// to Open Food Facts), so it's safe to deploy before the secret exists.
//
// Response shape and nutrition codes are confirmed against Kassalapp's own API
// page (kassal.app/api, the /products/ean example, checked 07.10.2026):
//   { data: Product | Product[] }, Product = { name, brand, image, ean,
//   current_price, nutrition: { code, display_name, amount, unit }[] }
// with codes energi_kcal ("Kalorier", kcal), energi_kj ("Energi", kj),
// fett_totalt, mettet_fett, karbohydrater, sukkerarter, protein, salt,
// kostfiber. The page doesn't state the basis, but its example values are the
// products' per-100 g label values (Grandiosa 975 kJ / 233 kcal), so amounts
// are read as per 100 g. Note "Energi" is the kJ row — energy is picked by
// code/unit, never by that label.
// Name-search results may omit nutrition (lighter projection) → macros null,
// the user fills/scans; the ean endpoint carries full nutrition.
//
// The ean endpoint answers { data: { ean, products: [<one row per store>],
// allergens, nutrition } } (docs example, 08.10.2026) — not a product — so the
// product fields come from its first store row and the nutrition from `data`.
//
// Shop's quick list (08.10.2026) adds two modes, same key:
//   { mode: 'grocery_search', search } → { products: [{ ean, name, brand, image,
//     price, store }] } — one row per EAN (`unique`), EAN-less rows left out, so
//     a pick can be priced at every chain.
//   { mode: 'grocery_prices', eans: [≤100] } → { prices: [{ ean, name, stores:
//     [{ code, name, price, checked }] }] } — POST /products/prices-bulk
//     (`stores[].current_price` / `last_checked`, docs example). Kassalapp has
//     no REMA 1000 prices (REMA publishes none online).

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

type Body = { search?: string; ean?: string; mode?: string; eans?: unknown }

async function kassal(path: string, key: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(`${KASSAL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (!r.ok) throw new Error(`kassalapp ${r.status}`)
  return await r.json()
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}

/** One grocery search hit: the EAN, a picture and one store's price (the chain comparison comes from `grocery_prices`). */
function groceryHit(item: Record<string, unknown>) {
  const store = (item.store ?? {}) as Record<string, unknown>
  const price = typeof item.current_price === 'object' && item.current_price !== null
    ? num((item.current_price as Record<string, unknown>).price)
    : num(item.current_price)
  return {
    ean: String(item.ean ?? '').replace(/\D/g, ''),
    name: String(item.name ?? '').trim(),
    brand: (item.brand as string) ?? null,
    image: (item.image as string) ?? null,
    price,
    store: (store.name as string) ?? null,
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const key = Deno.env.get('KASSALAPP_API_KEY')
  let body: Body = {}
  try { body = await req.json() } catch { /* empty */ }

  if (body.mode === 'grocery_search') {
    if (!key) return json({ products: [], error: 'not_configured' })
    const q = String(body.search ?? '').trim()
    if (!q) return json({ products: [] })
    try {
      const j = await kassal(`/products?search=${encodeURIComponent(q)}&size=12&unique=true&exclude_without_ean=true`, key)
      const rows = Array.isArray(j.data) ? j.data as Record<string, unknown>[] : []
      return json({ products: rows.map(groceryHit).filter(p => p.name && p.ean) })
    } catch (e) {
      return json({ products: [], error: String((e as Error).message ?? e) })
    }
  }

  if (body.mode === 'grocery_prices') {
    if (!key) return json({ prices: [], error: 'not_configured' })
    const eans = [...new Set((Array.isArray(body.eans) ? body.eans : []).map(e => String(e).replace(/\D/g, '')).filter(e => e.length >= 8))].slice(0, 100)
    if (!eans.length) return json({ prices: [] })
    try {
      const j = await kassal('/products/prices-bulk', key, { method: 'POST', body: JSON.stringify({ eans, days: 1, aggregation: 'min' }) })
      const rows = Array.isArray(j.data) ? j.data as Record<string, unknown>[] : []
      const prices = rows.map(r => ({
        ean: String(r.ean ?? ''),
        name: String(r.name ?? '').trim(),
        stores: (Array.isArray(r.stores) ? r.stores as Record<string, unknown>[] : [])
          .map(s => ({ code: String(s.store ?? ''), name: String(s.name ?? s.store ?? ''), price: num(s.current_price), checked: (s.last_checked as string) ?? null }))
          .filter(s => s.code && s.price != null),
      }))
      return json({ prices })
    } catch (e) {
      return json({ prices: [], error: String((e as Error).message ?? e) })
    }
  }

  if (!key) return json({ products: [], note: 'KASSALAPP_API_KEY not set' })
  try {
    if (body.ean) {
      const j = await kassal(`/products/ean/${encodeURIComponent(String(body.ean).replace(/\D/g, ''))}`, key)
      const data = (j.data ?? {}) as Record<string, unknown>
      const rows = Array.isArray(data.products) ? data.products as Record<string, unknown>[] : []
      const first = rows[0] ?? data
      const product = normalize({ ...first, ean: data.ean ?? first.ean, nutrition: data.nutrition ?? first.nutrition })
      return json({ products: product.name ? [product] : [] })
    }
    const j = await kassal(`/products?search=${encodeURIComponent(body.search ?? '')}&size=20`, key)
    const items = Array.isArray(j.data) ? j.data as Record<string, unknown>[] : (j.data ? [j.data as Record<string, unknown>] : [])
    const products = items.map(normalize).filter((p: { name: string }) => p.name)
    return json({ products })
  } catch (e) {
    return json({ products: [], error: String((e as Error).message ?? e) })
  }
})
