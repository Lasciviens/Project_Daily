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
//     (`stores[].current_price` / `last_checked`, docs example). REMA 1000,
//     Kiwi and Coop have no current prices, but their old ones still come
//     back, often from 2024 (Kassalapp's FAQ, 10.11.2026): passed on as they
//     are, and the app leaves out a price not checked in 14 days.
//   { mode: 'grocery_ean', ean } (10.11.2026) → { mode, products: [≤1 hit] } —
//     GET /products/ean/{ean} for a scanned barcode (the search matches names
//     only). The EAN must be 8–14 digits as sent, else 400 `bad_ean`; an
//     unknown one (404) is an empty list. Not tried live (no key).

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

// <supabase-keys>
// Supabase's new API keys (sb_secret_… / sb_publishable_…) arrive as JSON
// dictionaries keyed by name; the legacy JWT keys are the fallback until the
// owner switches them off (docs/backend/environment.md). Same in every
// function (scripts/verify-supabase-keys.cjs).
function supabaseKey(newVar: string, legacyVar: string): string {
  try {
    const keys = JSON.parse(Deno.env.get(newVar) ?? '{}') as Record<string, unknown>
    const key = keys.default ?? Object.values(keys)[0]
    if (typeof key === 'string' && key) return key
  } catch { /* not set or not JSON: the legacy key */ }
  return Deno.env.get(legacyVar) ?? ''
}
const serviceKey = () => supabaseKey('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY')
const publishableKey = () => supabaseKey('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY')
// </supabase-keys>

// Owner lock (security audit 10.10.2026, migration 139): this function serves
// only the owner (HEVY_USER_ID) and accounts listed in app_allowed_users (for
// example a test account). The owner never needs the table, so the check also
// works before migration 139 is applied.
async function isAppUser(userId: string): Promise<boolean> {
  if (userId === Deno.env.get('HEVY_USER_ID')) return true
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data, error } = await admin.from('app_allowed_users').select('user_id').eq('user_id', userId).maybeSingle()
  return !error && !!data
}

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
  if (!r.ok) throw Object.assign(new Error(`kassalapp ${r.status}`), { status: r.status })
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

// ── grocery_ean (10.11.2026): a scanned barcode's product ──────────────────
// Shape from Kassalapp's own example of GET /products/ean/{ean} (kassal.app/api)
// and its OpenAPI spec (kassal.app/docs/api.json, ProductComparisonResource),
// both read 10.11.2026 — no live sample (no key in development):
//   { data: { ean: string | null, products: [{ name, brand, image,
//     store: { name, code, url, logo }, current_price: { price, unit_price,
//     date }, … }], allergens, nutrition, labels } }
// One product row per chain. The spec types `store` and `current_price` as a
// list of those objects (or null) where the example shows one object: both are
// read. Every field is checked here, where it enters. The block runs in
// scripts/verify-shop-quick.cjs against that example.
// <grocery-ean>

/** An EAN as it may go into Kassalapp's address: digits only, 8 to 14 of them (EAN-8, UPC-A, EAN-13, GTIN-14). */
const EAN_RE = /^\d{8,14}$/
const PICTURE_MAX = 2048

/** Text from Kassalapp: a string, trimmed and at most `max` characters, else null. */
function shortText(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return /[\ud800-\udbff]$/.test(cut) ? cut.slice(0, -1) : cut
}

/** A picture only as an http(s) web link of up to 2 048 characters ("//cdn…" made https) — never a path, data: or javascript:. */
function webPicture(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s || s.length > PICTURE_MAX || /\s/.test(s) || [...s].some(ch => ch < ' ' || ch === '\u007f')) return null
  if (/^https?:\/\/[^/?#]+/i.test(s)) return s
  return /^\/\/[^/?#]+/.test(s) ? `https:${s}` : null
}

const asObject = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)

/** An object, or the first object of a list (the spec's shape for `store` and `current_price`), else null. */
const oneObject = (v: unknown) => asObject(Array.isArray(v) ? v[0] : v)

/** An amount: a finite number of 0 or more, or such a number written as text ("72.90", "72,90"), else null. */
function amount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** A chain's price row: its amount and its date when that reads as an ISO time. */
function eanPrice(v: unknown): { price: number | null; date: string | null } {
  const o = oneObject(v)
  const date = o && typeof o.date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(o.date) ? o.date : null
  return { price: amount(o ? o.price : v), date }
}

/**
 * The product a barcode is, as one grocery hit: the EAN asked for (Kassalapp's
 * own spelling when it gives the same number, leading zeros aside — anything
 * else is no hit), the name, brand, price and chain of the row with the
 * newest price date (the first named row without dates), and that row's
 * picture, else the first web picture another chain gives.
 */
function eanHit(data: unknown, asked: string) {
  const d = asObject(data)
  if (!d || !EAN_RE.test(asked)) return null
  const key = (s: string) => s.replace(/^0+/, '')
  const given = typeof d.ean === 'string' && EAN_RE.test(d.ean) ? d.ean : null
  if (d.ean != null && (!given || key(given) !== key(asked))) return null
  const rows = (Array.isArray(d.products) ? d.products : [])
    .map(asObject)
    .filter((p): p is Record<string, unknown> => p != null && shortText(p.name) != null)
  if (!rows.length) return null
  const priced = rows.map(p => ({ p, ...eanPrice(p.current_price) }))
  const best = priced.reduce((a, b) => ((b.date ?? '') > (a.date ?? '') ? b : a), priced[0])
  return {
    ean: given ?? asked,
    name: shortText(best.p.name) as string,
    brand: shortText(best.p.brand),
    image: webPicture(best.p.image) ?? rows.map(p => webPicture(p.image)).find(Boolean) ?? null,
    price: best.price,
    store: shortText(oneObject(best.p.store)?.name, 100),
  }
}
// </grocery-ean>

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  // Owner lock: platform JWT verification only proves "some project JWT"
  // (even the public anon key), so the caller is checked here too.
  const authHeader = req.headers.get('authorization') ?? ''
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey())
  const { data: { user } } = await admin.auth.getUser(authHeader.replace('Bearer ', ''))
  if (!user) return json({ error: 'Unauthorized' }, 401)
  if (!(await isAppUser(user.id))) return json({ error: 'forbidden' }, 403)
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

  // Answers carry the mode, so the app can tell this function from one deployed before it (whose `{ ean }` answer is Food's).
  if (body.mode === 'grocery_ean') {
    if (!key) return json({ mode: 'grocery_ean', products: [], error: 'not_configured' })
    // Checked as sent — never cleaned into shape: only 8–14 digits go into the address.
    const ean = typeof body.ean === 'string' ? body.ean : ''
    if (!EAN_RE.test(ean)) return json({ mode: 'grocery_ean', products: [], error: 'bad_ean' }, 400)
    try {
      const j = await kassal(`/products/ean/${ean}`, key)
      const hit = eanHit(j.data, ean)
      return json({ mode: 'grocery_ean', products: hit ? [hit] : [] })
    } catch (e) {
      // An EAN Kassalapp doesn't know is "no product", not a failure.
      if ((e as { status?: number }).status === 404) return json({ mode: 'grocery_ean', products: [] })
      return json({ mode: 'grocery_ean', products: [], error: String((e as Error).message ?? e) })
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
