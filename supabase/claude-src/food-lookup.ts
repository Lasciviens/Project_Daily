// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · find_food: per-100 g values from a database, never from the model
//
//  Ask AI guessed the fat of 150 g cottage cheese (owner, 24.11.2026). AI last: code looks the food up and code works
//  out the portion. In order:
//    1. the owner's own foods (`recipe_ingredient_library`, the Food page's list), read with the owner's rights and the
//       verified user id;
//    2. the outside databases the Food page searches: Kassalapp (kassal.app, the server's KASSALAPP_API_KEY, which
//       main.ts hands over; a Bearer header, never the address) and Open Food Facts (no key).
//  Two fixed hosts; the model's words go only into a URLSearchParams value; a reference (an EAN, a code) is only digits;
//  redirects are refused; 4 s and 2 MB per request, read as a stream. Everything an outside database sends is input:
//  read by type, per-100 g values only inside what a food can hold, names made one escaped line. A failure is our
//  own sentence, never the service's text.
//
//  A hit's `ref` (`food:<id>`, `kassal:<ean>`, `off:<code>`) is what propose_log_food and propose_update_food take: they
//  look it up again here (`foodByRef`), so a value the model writes is never the value saved.
//  docs/integrations/kassalapp.md and open-food-facts.md say what is read.
// ─────────────────────────────────────────────────────────────────────────────

import type { Db } from './ledger.ts'
import { escapeTagText } from './answer-reader.ts'

export const FOOD_LIMITS = {
  fetchMs: 4000, responseMax: 2_000_000 /* bytes */,
  /** Hits per source and in all. */
  perSource: 4, results: 8,
  /** The most grams a portion may be. */
  gramsMax: 3000,
  /** The owner's foods read for one search (a name match first, then the word check in code). */
  ownRows: 60,
} as const

export interface Per100 { calories: number; protein_g: number; carbs_g: number; fat_g: number }
export type FoodSource = 'yours' | 'kassalapp' | 'openfoodfacts'
export interface FoodHit { ref: string; source: FoodSource; name: string; brand: string | null; per100: Per100 }
export interface FoodIo { db: Db; userId: string; kassalKey: string; signal?: AbortSignal; requestMs?: number }

/** How a source is named on the Confirm card and in a tool result. */
export const FOOD_SOURCE_NAMES: Readonly<Record<FoodSource, string>> = { yours: 'your foods', kassalapp: 'Kassalapp', openfoodfacts: 'Open Food Facts' }

const KASSAL_SEARCH = 'https://kassal.app/api/v1/products'
const KASSAL_EAN = 'https://kassal.app/api/v1/products/ean/'
const OFF_SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl'
const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product/'
const OFF_FIELDS = 'code,product_name,product_name_en,brands,nutriments'
const FOOD_AGENT = 'LascisBoard/1.0 (personal food tracker)'
const FOOD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// ── Reading values ──────────────────────────────────────────────────────────

const ffObj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)
/** A number, or a number written as text ("4,3" too), else null. */
function ffNum(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+([.,]\d+)?\s*$/.test(v) ? Number(v.replace(',', '.')) : NaN
  return Number.isFinite(n) ? n : null
}

// Control, format and other invisible characters: never part of a name the model or the card shows.
// eslint-disable-next-line no-control-regex, no-misleading-character-class -- control and combining characters, alone, are exactly what is taken out
const FOOD_HIDDEN = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|\p{Cf}|\p{Cs}|\p{Co}/gu

/** A name from a database as one plain line: hidden characters out, spaces collapsed, cut. Null when nothing is left. Escaped where it enters a prompt (`foodHitLine`). */
export function foodName(v: unknown, max = 80): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(FOOD_HIDDEN, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return [...t].length > max ? `${[...t].slice(0, max).join('')}…` : t
}

/**
 * Per-100 g values a food can really have, or null: all four given, energy 0–950 kcal, each macro 0–100 g, and protein,
 * carbs and fat together at most 105 g (labels round). Anything else is a misread or a hostile answer, never "fixed".
 */
export function checkedPer100(raw: unknown): Per100 | null {
  const r = ffObj(raw)
  if (!r) return null
  const calories = ffNum(r.calories), protein = ffNum(r.protein_g), carbs = ffNum(r.carbs_g), fat = ffNum(r.fat_g)
  if (calories === null || protein === null || carbs === null || fat === null) return null
  if (calories < 0 || calories > 950 || [protein, carbs, fat].some(x => x < 0 || x > 100) || protein + carbs + fat > 105) return null
  const r2 = (x: number) => Math.round(x * 100) / 100
  return { calories: r2(calories), protein_g: r2(protein), carbs_g: r2(carbs), fat_g: r2(fat) }
}

/**
 * The portion of a food: each value × grams ÷ 100, rounded the way the database's own trigger rounds a food line
 * (106: round(round(per100 × grams) / 100, 2)), so the card and the saved line agree.
 */
export function portionOf(per100: Per100, grams: number): Per100 {
  const part = (v: number) => Math.round(Math.round(v * grams) / 100 * 100) / 100
  return { calories: part(per100.calories), protein_g: part(per100.protein_g), carbs_g: part(per100.carbs_g), fat_g: part(per100.fat_g) }
}

/** A reference find_food handed out: the owner's food by id, a Kassalapp EAN or an Open Food Facts code. Digits only for the last two. */
export function checkedFoodRef(v: unknown): { kind: 'food' | 'kassal' | 'off'; id: string } | null {
  if (typeof v !== 'string') return null
  const m = /^(food|kassal|off):([0-9a-f-]{36}|\d{8,14})$/.exec(v.trim().toLowerCase())
  if (!m) return null
  const kind = m[1] as 'food' | 'kassal' | 'off'
  if (kind === 'food' ? !FOOD_UUID.test(m[2]) : !/^\d{8,14}$/.test(m[2])) return null
  return { kind, id: m[2] }
}

// The word check of the Food page's online search (src/features/recipes/foodSearch.ts: foldText, containsEveryWord),
// copied: a result counts only when its names hold every typed word. verify-claude-chat runs both on the same samples.
function foodFold(s: string): string {
  return s.toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ı/g, 'i').replace(/đ/g, 'd')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim()
}
export function foodHasEveryWord(text: string, query: string): boolean {
  const all = foodFold(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const lettered = all.filter(w => /\p{L}/u.test(w))
  const words = lettered.length ? lettered : all
  if (!words.length) return false
  const letters = foodFold(text).replace(/[^\p{L}\p{N}]+/gu, '')
  return words.every(w => letters.includes(w))
}

// ── Asking an outside database ──────────────────────────────────────────────

type FoodAnswer = { ok: true; json: unknown; status: number } | { ok: false; why: 'late' | 'failed' | 'busy' | 'missing' }

/** One GET to one of the four fixed addresses: no redirect, a time limit, the size held while it is read. */
async function foodRequest(url: string, headers: Record<string, string>, io: FoodIo): Promise<FoodAnswer> {
  if (io.signal?.aborted) return { ok: false, why: 'late' }
  const controller = new AbortController()
  const onCallerAbort = () => controller.abort()
  io.signal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => controller.abort(), Math.max(500, Math.min(FOOD_LIMITS.fetchMs, io.requestMs ?? FOOD_LIMITS.fetchMs)))
  try {
    const res = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', ...headers }, redirect: 'error', signal: controller.signal })
    if (res.status === 404) { await res.body?.cancel?.().catch(() => {}); return { ok: false, why: 'missing' } }
    if (res.status === 429 || res.status === 503) { await res.body?.cancel?.().catch(() => {}); return { ok: false, why: 'busy' } }
    if (!res.ok) { await res.body?.cancel?.().catch(() => {}); return { ok: false, why: 'failed' } }
    const stated = Number(res.headers?.get?.('content-length'))
    if (Number.isFinite(stated) && stated > FOOD_LIMITS.responseMax) { await res.body?.cancel?.().catch(() => {}); return { ok: false, why: 'failed' } }
    let text = ''
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let bytes = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > FOOD_LIMITS.responseMax) { await reader.cancel().catch(() => {}); return { ok: false, why: 'failed' } }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } else {
      text = await res.text()
      if (text.length > FOOD_LIMITS.responseMax) return { ok: false, why: 'failed' }
    }
    return { ok: true, json: JSON.parse(text) as unknown, status: res.status }
  } catch {
    return { ok: false, why: controller.signal.aborted ? 'late' : 'failed' }
  } finally {
    clearTimeout(timer)
    io.signal?.removeEventListener('abort', onCallerAbort)
  }
}

// Kassalapp's nutrition rows (food-search's `normalize`, the codes from Kassalapp's own API page): { code, amount, unit }
// per 100 g. Energy by its code or unit, a kJ row turned into kcal only when there is no kcal row.
function kassalValue(nutrition: unknown, code: string): number | null {
  if (!Array.isArray(nutrition)) return null
  const row = nutrition.map(ffObj).find(n => n !== null && String(n.code ?? '').toLowerCase() === code)
  return row ? ffNum(row.amount) : null
}
function kassalKcal(nutrition: unknown): number | null {
  if (!Array.isArray(nutrition)) return null
  const rows = nutrition.map(ffObj).filter((n): n is Record<string, unknown> => n !== null)
  const kcal = rows.find(n => String(n.code ?? '').toLowerCase() === 'energi_kcal')
  if (kcal) return ffNum(kcal.amount)
  const kj = rows.find(n => String(n.code ?? '').toLowerCase() === 'energi_kj')
  const v = kj ? ffNum(kj.amount) : null
  return v === null ? null : Math.round((v / 4.184) * 10) / 10
}
function kassalPer100(nutrition: unknown): Per100 | null {
  return checkedPer100({ calories: kassalKcal(nutrition), protein_g: kassalValue(nutrition, 'protein'), carbs_g: kassalValue(nutrition, 'karbohydrater'), fat_g: kassalValue(nutrition, 'fett_totalt') })
}

/** A Kassalapp product as a hit: its EAN (digits, 8–14), a name, per-100 g values that pass the check; else null. */
function kassalHit(item: unknown, nutrition?: unknown): FoodHit | null {
  const p = ffObj(item)
  if (!p) return null
  const ean = typeof p.ean === 'string' ? p.ean.trim() : ''
  const name = foodName(p.name)
  const per100 = kassalPer100(nutrition ?? p.nutrition)
  if (!/^\d{8,14}$/.test(ean) || !name || !per100) return null
  return { ref: `kassal:${ean}`, source: 'kassalapp', name, brand: foodName(p.brand, 40), per100 }
}

// Open Food Facts' product (docs/integrations/open-food-facts.md, live answers of 03.11.2026 and 24.11.2026): the names, the
// brands as one text, `nutriments` per 100 g; energy in kcal, else kJ ÷ 4.184.
function offHit(item: unknown): FoodHit | null {
  const p = ffObj(item)
  const n = ffObj(p?.nutriments)
  if (!p || !n) return null
  const code = typeof p.code === 'string' ? p.code.trim() : ''
  const name = foodName(p.product_name_en) ?? foodName(p.product_name)
  const kj = ffNum(n.energy_100g)
  const per100 = checkedPer100({ calories: ffNum(n['energy-kcal_100g']) ?? (kj === null ? null : Math.round((kj / 4.184) * 10) / 10), protein_g: n.proteins_100g, carbs_g: n.carbohydrates_100g, fat_g: n.fat_100g })
  if (!/^\d{8,14}$/.test(code) || !name || !per100) return null
  return { ref: `off:${code}`, source: 'openfoodfacts', name, brand: foodName(p.brands, 40), per100 }
}
const offNames = (item: unknown): string => {
  const p = ffObj(item)
  return [p?.product_name_en, p?.product_name, p?.brands].filter((s): s is string => typeof s === 'string').join(' ')
}

/** The owner's own foods whose name holds every word, with complete per-100 g values. */
async function ownFoods(query: string, io: FoodIo): Promise<FoodHit[] | null> {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => /\p{L}/u.test(w))
  const longest = [...words].sort((a, b) => b.length - a.length)[0]
  if (!longest) return []
  const like = `%${longest.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`
  const { data, error } = await io.db.from('recipe_ingredient_library').select('id, name, calories, protein_g, carbs_g, fat_g')
    .eq('user_id', io.userId).ilike('name', like).order('name', { ascending: true }).limit(FOOD_LIMITS.ownRows)
  if (error) return null
  const out: FoodHit[] = []
  for (const row of Array.isArray(data) ? data : []) {
    const r = ffObj(row)
    const id = typeof r?.id === 'string' ? r.id.toLowerCase() : ''
    const name = foodName(r?.name)
    const per100 = checkedPer100(r)
    if (!FOOD_UUID.test(id) || !name || !per100 || typeof r?.name !== 'string' || !foodHasEveryWord(r.name, query)) continue
    out.push({ ref: `food:${id}`, source: 'yours', name, brand: null, per100 })
    if (out.length >= FOOD_LIMITS.perSource) break
  }
  return out
}

async function kassalSearch(query: string, io: FoodIo): Promise<FoodHit[] | FoodAnswer> {
  const answer = await foodRequest(`${KASSAL_SEARCH}?${new URLSearchParams({ search: query, size: '10' })}`, { Authorization: `Bearer ${io.kassalKey}` }, io)
  if (!answer.ok) return answer
  const rows = ffObj(answer.json)?.data
  const out: FoodHit[] = []
  for (const item of Array.isArray(rows) ? rows : []) {
    const p = ffObj(item)
    if (!p || typeof p.name !== 'string' || !foodHasEveryWord(`${p.name} ${typeof p.brand === 'string' ? p.brand : ''}`, query)) continue
    const hit = kassalHit(p)
    if (hit && !out.some(h => h.ref === hit.ref)) out.push(hit)
    if (out.length >= FOOD_LIMITS.perSource) break
  }
  return out
}

async function offSearch(query: string, io: FoodIo): Promise<FoodHit[] | FoodAnswer> {
  const search = new URLSearchParams({ search_terms: query, search_simple: '1', action: 'process', json: '1', fields: OFF_FIELDS, page_size: '30', sort_by: 'popularity_key' })
  const answer = await foodRequest(`${OFF_SEARCH}?${search}`, { 'User-Agent': FOOD_AGENT }, io)
  if (!answer.ok) return answer
  const rows = ffObj(answer.json)?.products
  const out: FoodHit[] = []
  for (const item of Array.isArray(rows) ? rows : []) {
    if (!foodHasEveryWord(offNames(item), query)) continue
    const hit = offHit(item)
    if (hit && !out.some(h => h.ref === hit.ref)) out.push(hit)
    if (out.length >= FOOD_LIMITS.perSource) break
  }
  return out
}

const NOT_ASKED = (why: FoodAnswer & { ok: false }) => (why.why === 'busy' ? 'busy right now' : why.why === 'late' ? 'did not answer in time' : 'could not be read')

/**
 * The search: the owner's foods first, then Kassalapp and Open Food Facts side by side (Kassalapp only with a key, and
 * only for three letters or more: its minimum). `notes` says which source could not be asked, in our own words.
 */
export async function findFood(query: string, io: FoodIo): Promise<{ ok: true; hits: FoodHit[]; notes: string[] } | { ok: false; message: string }> {
  const q = query.replace(FOOD_HIDDEN, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!/\p{L}/u.test(q)) return { ok: false, message: 'Give the food\'s name in "query" (letters, not only numbers).' }
  const own = await ownFoods(q, io)
  const notes: string[] = []
  if (own === null) notes.push('Your own foods could not be read just now.')
  const [kassal, off] = await Promise.all([
    io.kassalKey && q.length >= 3 ? kassalSearch(q, io) : Promise.resolve([] as FoodHit[]),
    offSearch(q, io),
  ])
  const outside: FoodHit[] = []
  for (const [name, result] of [['Kassalapp', kassal], ['Open Food Facts', off]] as const) {
    if (Array.isArray(result)) outside.push(...result)
    else if (!result.ok) notes.push(`${name} ${NOT_ASKED(result)}.`)
  }
  if (!io.kassalKey) notes.push('Kassalapp is not set up on the server.')
  return { ok: true, hits: [...(own ?? []), ...outside].slice(0, FOOD_LIMITS.results), notes }
}

/** One food again by the reference find_food gave: the owner's own row (by id and user), or the outside product by its number. */
export async function foodByRef(ref: unknown, io: FoodIo): Promise<{ ok: true; hit: FoodHit } | { ok: false; message: string }> {
  const r = checkedFoodRef(ref)
  const notFound = { ok: false as const, message: 'That food_ref is not one find_food gave. Call find_food again and copy a ref, or send "" and estimate.' }
  if (!r) return notFound
  if (r.kind === 'food') {
    const { data, error } = await io.db.from('recipe_ingredient_library').select('id, name, calories, protein_g, carbs_g, fat_g').eq('user_id', io.userId).eq('id', r.id).maybeSingle()
    if (error) return { ok: false, message: 'Your foods could not be read just now. Try again.' }
    const row = ffObj(data)
    const name = foodName(row?.name)
    const per100 = checkedPer100(row)
    if (!row || !name) return notFound
    if (!per100) return { ok: false, message: 'That food of the person has no complete values per 100 g. Use another, or estimate.' }
    return { ok: true, hit: { ref: `food:${r.id}`, source: 'yours', name, brand: null, per100 } }
  }
  if (r.kind === 'kassal') {
    if (!io.kassalKey) return { ok: false, message: 'Kassalapp is not set up on the server. Use another ref, or estimate.' }
    const answer = await foodRequest(`${KASSAL_EAN}${r.id}`, { Authorization: `Bearer ${io.kassalKey}` }, io)
    if (!answer.ok) return answer.why === 'missing' ? notFound : { ok: false, message: `Kassalapp ${NOT_ASKED(answer)}. Try again once, or estimate.` }
    // The EAN answer: { data: { ean, products: [one row per chain], nutrition } } (Kassalapp's API page example).
    const d = ffObj(ffObj(answer.json)?.data)
    const first = Array.isArray(d?.products) ? d?.products.map(ffObj).find(p => p !== null && typeof p.name === 'string') : null
    const given = typeof d?.ean === 'string' ? d.ean.replace(/^0+/, '') : null
    if (!d || !first || (given !== null && given !== r.id.replace(/^0+/, ''))) return notFound
    const hit = kassalHit({ ...first, ean: r.id }, d.nutrition ?? first.nutrition)
    return hit ? { ok: true, hit } : { ok: false, message: 'Kassalapp has no complete values per 100 g for that product. Use another, or estimate.' }
  }
  const answer = await foodRequest(`${OFF_PRODUCT}${r.id}.json?${new URLSearchParams({ fields: OFF_FIELDS })}`, { 'User-Agent': FOOD_AGENT }, io)
  if (!answer.ok) return answer.why === 'missing' ? notFound : { ok: false, message: `Open Food Facts ${NOT_ASKED(answer)}. Try again once, or estimate.` }
  const product = ffObj(ffObj(answer.json)?.product)
  if (!product || (typeof product.code === 'string' && product.code.trim() !== r.id)) return notFound
  const hit = offHit({ ...product, code: r.id })
  return hit ? { ok: true, hit } : { ok: false, message: 'Open Food Facts has no complete values per 100 g for that product. Use another, or estimate.' }
}

/** How a hit is written in a tool result: data, one line each. */
export function foodHitLine(h: FoodHit): string {
  const v = h.per100
  return `- ref ${h.ref} · ${escapeTagText(h.name)}${h.brand ? ` (${escapeTagText(h.brand)})` : ''} · from ${FOOD_SOURCE_NAMES[h.source]} · per 100 g: ${v.calories} kcal, protein ${v.protein_g} g, carbs ${v.carbs_g} g, fat ${v.fat_g} g`
}
