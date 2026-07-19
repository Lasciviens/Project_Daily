// food-search — proxies Kassalapp (kassal.app) so the API token stays
// server-side (KASSALAPP_API_KEY in Vault, never in the client). Returns
// Norwegian grocery products normalized to the app's per-100g BarcodeProduct
// shape. If the key isn't set it returns an empty list (the client falls back
// to Open Food Facts), so it's safe to deploy before the secret exists.
//
// ⚠️ NUTRITION FIELD MAPPING IS DEFENSIVE / UNVERIFIED: Kassalapp's public docs
// are Cloudflare-gated and its exact nutrition JSON shape couldn't be confirmed
// without the token. `normalize()` probes several plausible shapes and falls
// back to null (never crashes). After deploying with the key, log ONE sample
// product JSON and lock the field names — do NOT trust the macros until then.

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

// Defensive nutrition extraction — Kassalapp returns a `nutrition` array of
// { code?/display_name?, amount?/value?, unit? } (per 100g). Probe by name.
function macro(nutrition: unknown, keys: string[]): number | null {
  if (!Array.isArray(nutrition)) return null
  const row = nutrition.find((n: Record<string, unknown>) => {
    const label = String(n?.code ?? n?.display_name ?? n?.name ?? '').toLowerCase()
    return keys.some(k => label.includes(k))
  }) as Record<string, unknown> | undefined
  return row ? toNum(row.amount ?? row.value ?? row.quantity) : null
}

function normalize(item: Record<string, unknown>) {
  const nutr = item.nutrition
  let calories = macro(nutr, ['kcal', 'kalori'])
  const kj = macro(nutr, ['kj', 'energi', 'energy'])
  if (calories == null && kj != null) calories = Math.round((kj / 4.184) * 10) / 10   // kJ→kcal fallback
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
