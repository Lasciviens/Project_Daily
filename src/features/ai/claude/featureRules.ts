// Pure rules of the AI features of 22.11.2026 (docs/features/ai-plan.md → "The features the owner picked"): what
// code does before and after the model. Import-free except for types and two pure helpers, so
// scripts/verify-ai-features.cjs can run it against the real module.
//
//   photos        how big a photo is sent (at most 1280 px, JPEG), and the `{ media_type, data }` it travels as
//   receipt       the app's second check of a read receipt (the function checked it once), the match of the printed
//                 store to the owner's own stores, and the form fields it fills
//   week          the week's closed Work tasks, goals and notes, counted and cut to what the job takes
//   error         an error with its secrets taken out before any of it is sent (the function does it again)
//   Dev Requests  the draft's fields, checked against the app's own page list
//   ideas         the idea lines as they are appended to a wish's notes

/** What a call cost, for the line after a result: four decimals under a cent, else three; empty when it is not known. */
export function costNote(usd: number | null | undefined): string {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd < 0) return ''
  return '≈ $' + (usd < 0.01 ? usd.toFixed(4) : usd.toFixed(3))
}

// ── photos ────────────────────────────────────────────────────────────────────

/** The longest side of a photo that is sent (the function accepts 1600). */
export const PHOTO_LONG_SIDE = 1280
/** JPEG quality of the re-encoded photo. */
export const PHOTO_QUALITY = 0.85
/** The most bytes a re-encoded photo may have: the function takes 1.4 million base64 characters, ¾ of that is bytes. */
export const PHOTO_MAX_BYTES = 1_000_000

/** The size a photo is drawn at: its own, or scaled down so its long side is `max`. Never scaled up. */
export function fitWithin(width: number, height: number, max = PHOTO_LONG_SIDE): { width: number; height: number } {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
  const long = Math.max(w, h)
  if (long <= max) return { width: w, height: h }
  const scale = max / long
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

/** What a photo job takes: the type and the base64 bytes (no `data:` prefix). */
export interface PhotoInput { media_type: 'image/jpeg'; data: string }

/** A `data:image/jpeg;base64,…` address as the job's input, or null when it is anything else. */
export function photoFromDataUrl(url: string): PhotoInput | null {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
  return m ? { media_type: 'image/jpeg', data: m[1] } : null
}

/** What a PDF job takes: the type and the base64 bytes (no `data:` prefix). */
export interface PdfInput { media_type: 'application/pdf'; data: string }
/** The most bytes of a PDF that is sent: the function takes 1.4 million base64 characters (a receipt is one to three pages). */
export const PDF_MAX_BYTES = 1_000_000

/**
 * A PDF's bytes as the job's input, or an Error with a sentence for the owner. Only the file's own first bytes
 * (`%PDF-`) say it is one, whatever its name or type says; a password-protected one (an /Encrypt entry) is refused here
 * as it is in the function.
 */
export function pdfFromBytes(bytes: Uint8Array): PdfInput {
  if (bytes.length > PDF_MAX_BYTES) throw new Error('That PDF is too large (at most 1 MB) — a receipt is one to four pages')
  if (bytes.length < 8 || String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') throw new Error("That file isn't a PDF")
  let text = ''
  for (let i = 0; i < bytes.length; i += 32_768) text += String.fromCharCode(...bytes.subarray(i, i + 32_768))
  if (text.includes('/Encrypt')) throw new Error('That PDF is password protected — open it, then save or print a copy without the password')
  return { media_type: 'application/pdf', data: btoa(text) }
}

// ── receipt ───────────────────────────────────────────────────────────────────

export const RECEIPT_CURRENCIES: readonly string[] = ['NOK', 'TRY', 'EUR', 'USD']
const AMOUNT_MAX = 5_000_000

export type ReceiptKind = 'bought' | 'sold' | 'unknown'
export const RECEIPT_CONDITIONS = ['new', 'used', 'outlet', 'refurbished'] as const
export type ReceiptCondition = typeof RECEIPT_CONDITIONS[number]
/** One product line. `price` is the line total after discount, VAT included. The other keys exist only when the receipt gave them. */
export interface ReceiptLine { name: string; price: number | null; /** The full product name as sold, from the print or found by a web search. */ product?: string; brand?: string; model?: string; quantity?: number; condition?: ReceiptCondition
  /** One of the categories the app sent (never anything else): the function mapped the model's number back to this id. */
  category_id?: string
  /** Pages to try for the product's picture, best first (at most 3, https, each ≤ 2 048): addresses the function's own web search returned. The app reads them through shop-price one after another; nothing else fetches or opens them. */
  page_urls?: string[]
  /** True when the first page is the one the AI named for this product; false when the pages are search results the function picked (each must then show the same product). */
  page_named?: boolean
  /**
   * What the receipt prints about money off this line, kept apart (owner, 23.11.2026): `before` = the product's normal price when the
   * receipt shows one, `discount` = the amount taken off with its `discount_reason`, `price` = what was paid (already after it).
   * A discount is never worked out from a normal price: it may be an extra one (points, a card), and the normal price may be higher.
   */
  discount?: number; before?: number; discount_reason?: DiscountReason }
/** Why a discount was given, as the receipt says (else `other`). */
export const DISCOUNT_REASONS = ['points', 'member', 'campaign', 'coupon', 'staff', 'other'] as const
export type DiscountReason = typeof DISCOUNT_REASONS[number]
/** How a stored discount reads on screen: "member discount". */
export const REASON_WORD: Record<DiscountReason, string> = { points: 'points discount', member: 'member discount', campaign: 'campaign discount', coupon: 'coupon discount', staff: 'staff discount', other: 'discount' }
/** What a receipt's extra cost is. A discount is money off the whole receipt (written as a negative cost). */
export const RECEIPT_COST_KINDS = ['shipping', 'fee', 'service', 'warranty', 'insurance', 'deposit', 'discount'] as const
export type ReceiptCostKind = typeof RECEIPT_COST_KINDS[number]
export interface ReceiptCost { kind: ReceiptCostKind; name?: string; amount: number; reason?: DiscountReason }
export interface ReceiptRead {
  /** Bought or sold; only present when the answer said so (absent reads as unknown). */
  kind?: ReceiptKind
  /** How it was bought, when the receipt says: a web order or in a store. */
  channel?: 'online' | 'in_store'
  /** The function really ran a web search for this read (its own count, not the model's word). */
  searched?: boolean
  store?: string
  /** YYYY-MM-DD */
  date?: string
  currency?: string
  total?: number
  items?: ReceiptLine[]
  /** The money lines that are not products (shipping, fees, services, an extended warranty, insurance, a deposit, a discount on the whole receipt). */
  costs?: ReceiptCost[]
  warranty_months?: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const line = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  // Zero-width and text-direction characters draw nothing and can hide a word from a check: out first.
  const t = v.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim()
  return t && [...t].length <= max ? t : null
}
/** A shipping or pick-up line, a bag, a deposit, a fee: never a product (the function drops them too). */
const NOT_A_PRODUCT = /^(pick-?up point|frakt|shipping|delivery|levering|fraktkostnad|bæreposer?|plastpose|pant|gebyr|fee)\b/i
/** A link, "www.", a leading slash or "//": a slash inside a model ("16/512 GB") is fine. */
const LINKLIKE = /https?:|www\.|^\/|\/\//i
const word = (v: unknown, max = 60): string | null => { const t = line(v, max); return t && !LINKLIKE.test(t) ? t : null }
const amount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0.01 && v <= AMOUNT_MAX ? Math.round(v * 100) / 100 : null)

/**
 * A product page link: https, at most 2 048 characters, no white space, control or invisible character, no user name,
 * password or port. The function already kept only an address its own search returned; this is the app's second look.
 */
export function pageLink(v: unknown): string | null {
  // eslint-disable-next-line no-control-regex -- control and invisible characters are exactly what is refused
  if (typeof v !== 'string' || !v || v.length > 2048 || !/^https:\/\/[^\s\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+$/.test(v)) return null
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password && !u.port ? v : null } catch { return null }
}

/** A real calendar day YYYY-MM-DD, or null. */
export function realDay(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  const [y, m, d] = v.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? v : null
}

/**
 * The function's answer, checked again here with the same limits (the browser never trusts the answer it was
 * handed): an amount that is positive and at most 5 million, a currency of three capital letters, a day that is real,
 * not after `today` and at most 5 years back, texts within their limits. A value that fails is dropped, never repaired.
 * Null when nothing is left.
 */
export function readReceipt(raw: unknown, today: string, categoryIds: ReadonlySet<string> = new Set()): ReceiptRead | null {
  if (!isObj(raw)) return null
  const out: ReceiptRead = {}
  if (raw.kind === 'bought' || raw.kind === 'sold' || raw.kind === 'unknown') out.kind = raw.kind
  if (raw.channel === 'online' || raw.channel === 'in_store') out.channel = raw.channel
  if (raw.searched === true) out.searched = true
  // A store number in front of the name is not part of it (so the match to your own stores works).
  const store = line(raw.store, 80)?.replace(/^\d{2,6}\s+/, '') || null
  if (store && !/https?:|www\.|\//i.test(store)) out.store = store
  const date = realDay(raw.date)
  if (date && date <= today && date >= `${Number(today.slice(0, 4)) - 5}${today.slice(4)}`) out.date = date
  if (typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency)) out.currency = raw.currency
  const total = amount(raw.total)
  if (total !== null) out.total = total
  const lines: ReceiptLine[] = []
  if (Array.isArray(raw.items)) {
    for (const it of raw.items.slice(0, 40)) {
      if (!isObj(it)) continue
      const name = line(it.name, 120)
      if (!name || NOT_A_PRODUCT.test(name)) continue
      const price = amount(it.price)
      if (price === 0.01) continue
      const entry: ReceiptLine = { name, price }
      const product = word(it.product, 120), brand = word(it.brand), model = word(it.model)
      if (product) entry.product = product
      if (brand) entry.brand = brand
      if (model) entry.model = model
      const pages = (Array.isArray(it.page_urls) ? it.page_urls : []).slice(0, 3).map(pageLink).filter((x): x is string => !!x)
      if (pages.length) { entry.page_urls = pages; entry.page_named = it.page_named === true }
      // The same agreement the function checks: the old price above the paid one, the discount below the old price; else both go.
      const before = amount(it.before), discount = amount(it.discount)
      const agree = !(before !== null && price !== null && before <= price) && !(discount !== null && before !== null && discount >= before)
      if (agree && before !== null) entry.before = before
      if (agree && discount !== null) {
        entry.discount = discount
        entry.discount_reason = DISCOUNT_REASONS.find(r => r === it.discount_reason) ?? 'other'
      }
      if (typeof it.quantity === 'number' && Number.isInteger(it.quantity) && it.quantity >= 1 && it.quantity <= 99) entry.quantity = it.quantity
      const condition = RECEIPT_CONDITIONS.find(c => c === it.condition)
      if (condition) entry.condition = condition
      // Only an id the app itself sent with the file: the answer is input, so an id of any other kind is dropped.
      if (typeof it.category_id === 'string' && categoryIds.has(it.category_id)) entry.category_id = it.category_id
      lines.push(entry)
    }
  }
  // More than 12: the 12 with the highest prices (a line with no price last), in the order they were printed.
  const keep = lines.length > 12 ? new Set(lines.map((_, i) => i).sort((a, b) => (lines[b].price ?? -1) - (lines[a].price ?? -1) || a - b).slice(0, 12)) : null
  const items = keep ? lines.filter((_, i) => keep.has(i)) : lines
  if (items.length) out.items = items
  const costs: ReceiptCost[] = []
  if (Array.isArray(raw.costs)) {
    for (const c of raw.costs.slice(0, 40)) {
      if (!isObj(c)) continue
      const kind = RECEIPT_COST_KINDS.find(k => k === c.kind)
      const amountOf = amount(c.amount)
      if (!kind || amountOf === null || amountOf === 0.01) continue
      const name = word(c.name, 60)
      costs.push({ kind, ...(name ? { name } : {}), amount: amountOf, ...(kind === 'discount' ? { reason: DISCOUNT_REASONS.find(r => r === c.reason) ?? 'other' } : {}) })
      if (costs.length >= 8) break
    }
  }
  if (costs.length) out.costs = costs
  if (typeof raw.warranty_months === 'number' && Number.isInteger(raw.warranty_months) && raw.warranty_months >= 1 && raw.warranty_months <= 120) out.warranty_months = raw.warranty_months
  // A kind alone is no receipt.
  return Object.keys(out).some(k => k !== 'kind' && k !== 'channel' && k !== 'searched') ? out : null
}

/** A name with case, accents, spaces and punctuation gone: "Elkjøp Norge AS" and "ELKJOP" meet. */
export function foldName(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ø/gi, 'o').replace(/æ/gi, 'ae').replace(/å/gi, 'a').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** The company words a printed name may carry after the store's own name. */
const COMPANY_WORDS = /\b(as|asa|ab|oy|a\/s|ltd|inc|gmbh|norge|norway|norsk|sverige|danmark)\b/gi

/**
 * The owner's own store the printed name is: the one whose name equals it, else the one whose name it starts with
 * once the company words are gone ("ELKJØP NORGE AS" → Elkjøp). Only a single, clear match counts, a name of fewer
 * than 3 characters never matches, a hidden or price-site store is never offered. Code, not the model: the AI only
 * reads what is printed, and no store is ever made from it.
 */
export function matchStore<S extends { id: string; name: string; hidden?: boolean; kind?: string }>(printed: string | undefined, stores: readonly S[]): S | null {
  if (!printed) return null
  const pick = stores.filter(s => !s.hidden && s.kind !== 'price_site' && foldName(s.name).length >= 3)
  const full = foldName(printed)
  const bare = foldName(printed.replace(COMPANY_WORDS, ' '))
  const exact = pick.filter(s => foldName(s.name) === full || foldName(s.name) === bare)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const starts = pick.filter(s => bare.startsWith(foldName(s.name)))
  if (starts.length === 0) return null
  const longest = Math.max(...starts.map(s => foldName(s.name).length))
  const best = starts.filter(s => foldName(s.name).length === longest)
  return best.length === 1 ? best[0] : null
}

/** What a receipt fills in a form. Every field is optional; the owner confirms them all. */
export interface ReceiptFill {
  title?: string
  /** The picked line's category, one of the owner's own (the id that was sent with the file). */
  categoryId?: string
  /** The picked line's brand and model, and its condition as the app holds one (Outlet is not one: it goes in the note). */
  brand?: string
  model?: string
  condition?: 'new' | 'used' | 'refurbished'
  price?: number
  currency?: string
  day?: string
  /** The owner's own store it matched, or null; `storeName` is what is printed when none matched. */
  storeId: string | null
  storeName: string | null
  /** The store as a form shows it: the matched store's own name, else the printed one. */
  storeLabel: string | null
  /** The read searched the web: what it found (the product, brand and model) is a fact to check. */
  searched?: boolean
  /** A web order or a store, when the receipt says. */
  channel?: 'online' | 'in_store'
  /** A line for the receipt note: what was read and could not go in a field (a warranty, a total that differs). */
  note: string
  /** The day a printed warranty ends (the purchase day plus its months), YYYY-MM-DD. */
  warrantyUntil?: string
  /** Every item line's name (for matching a thing to a line), and the lines that were not picked (with a price). */
  lines: string[]
  others: ReceiptLine[]
  /** Why a value was left out, in a sentence for the owner. */
  left: string[]
  /** The line's product pages to try for a picture (links its own web search returned): read through shop-price, nothing else. */
  pageUrls?: string[]
  pageNamed?: boolean
  /** The product's normal price, when the receipt prints one (the record's "Price before discount" field; never worked out). */
  before?: number
  /** What the receipt took off this line and why: stored on the thing (`discount_amount`, `discount_reason`, migration 203); the paid price stays the price. */
  discount?: number
  discountReason?: DiscountReason
  /** The receipt's extra costs this line carries (the dearest line by default; the owner moves them). Signed: a discount is negative. */
  costs: ReceiptCostFill[]
}
/** One extra cost of a draft: what it is called, the signed amount (money off is negative) and its currency. */
export interface ReceiptCostFill { kind: ReceiptCostKind; label: string; amount: number; currency: string }
const COST_WORD: Record<ReceiptCostKind, string> = { shipping: 'Shipping', fee: 'Fee', service: 'Service', warranty: 'Extended warranty', insurance: 'Insurance', deposit: 'Deposit', discount: 'Discount' }
/** The kinds whose printed name says more than the kind ("Utvidet garanti 3 år"): the name stays after the English word. Shipping, deposit and discount are the word alone. */
const NAME_ADDS: readonly ReceiptCostKind[] = ['fee', 'service', 'warranty', 'insurance']
/** The words a saved receipt cost carries, in English (saved data is English): the kind's word — a discount as "Points discount" / "Member discount" — and the printed name only when it adds something and is no repeat of the word. */
export const costLabel = (c: ReceiptCost): string => {
  if (c.kind === 'discount') { const w = REASON_WORD[c.reason ?? 'other']; return `${w[0].toUpperCase()}${w.slice(1)}` }
  const word = COST_WORD[c.kind]
  return (NAME_ADDS.includes(c.kind) && c.name && c.name.toLocaleLowerCase('nb') !== word.toLocaleLowerCase('nb') ? `${word} · ${c.name}` : word).slice(0, 80)
}

/** DD.MM.YYYY of a YYYY-MM-DD. */
const dotDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

/** The day `months` after `day`, YYYY-MM-DD (the day of the month is kept, or the month's last day). */
export function addMonthsToDay(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const total = m - 1 + months
  const year = y + Math.floor(total / 12), month = ((total % 12) + 12) % 12
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** The words of a thing's name that say what it is (3 or more letters or digits, no filler). */
function nameWords(s: string): string[] {
  const filler = new Set(['the', 'and', 'for', 'with', 'new', 'used', 'black', 'white', 'grey', 'gray', 'blue', 'red', 'pro', 'max'])
  return (s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ø/gi, 'o').replace(/æ/gi, 'ae').replace(/å/gi, 'a').toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter(w => !filler.has(w))
}

/**
 * The receipt line that is this thing: the line sharing a model-like word with it (a word with a digit, "xm5"),
 * else the one sharing at least two words, else the only line sharing one when the others share none. Null when no
 * line looks like it: Just bought then warns instead of putting a stranger's price on the thing.
 */
export function matchLine(itemTitle: string, lines: readonly string[]): number | null {
  const mine = new Set(nameWords(itemTitle))
  if (!mine.size) return null
  const shared = lines.map(l => nameWords(l).filter(w => mine.has(w)))
  const withDigit = shared.map((w, i) => ({ i, hit: w.some(x => /\d/.test(x)) })).filter(x => x.hit)
  if (withDigit.length === 1) return withDigit[0].i
  const two = shared.map((w, i) => ({ i, n: new Set(w).size })).filter(x => x.n >= 2)
  if (two.length === 1) return two[0].i
  const one = shared.map((w, i) => ({ i, n: w.length })).filter(x => x.n >= 1)
  return one.length === 1 && two.length === 0 && withDigit.length === 0 ? one[0].i : null
}

/**
 * The form fields a read receipt fills (a line's category too, when the function chose one of the owner's own). `pick` is the item line the owner chose (a receipt of many lines is never
 * guessed at): its price is the amount paid; a receipt of one line takes that line, and with no line the total is
 * the amount. An amount is only filled with a currency this app holds (never converted, never assumed).
 */
export function receiptFill(read: ReceiptRead, stores: readonly { id: string; name: string; hidden?: boolean; kind?: string }[], pick: number | null | 'total'): ReceiptFill {
  const left: string[] = []
  const lines = read.items ?? []
  const chosenAt = pick === 'total' ? null : typeof pick === 'number' && lines[pick] ? pick : lines.length === 1 ? 0 : null
  const chosen = chosenAt === null ? null : lines[chosenAt]
  const store = matchStore(read.store, stores)
  const fill: ReceiptFill = {
    storeId: store ? store.id : null, storeName: store || !read.store ? null : read.store, storeLabel: store ? store.name : read.store ?? null,
    note: '', left, lines: lines.map(l => l.name), others: chosen ? lines.filter((_, i) => i !== chosenAt) : [], costs: [],
  }
  if (chosen) {
    fill.title = chosen.product ?? chosen.name
    if (chosen.brand) fill.brand = chosen.brand
    if (chosen.category_id) fill.categoryId = chosen.category_id
    if (chosen.model) fill.model = chosen.model
    if (chosen.page_urls?.length) { fill.pageUrls = chosen.page_urls; fill.pageNamed = chosen.page_named === true }
    // The normal price only when the receipt prints one; a discount is its own note, never a normal price worked out.
    if (chosen.before !== undefined) fill.before = chosen.before
    if (chosen.discount !== undefined) { fill.discount = chosen.discount; fill.discountReason = chosen.discount_reason ?? 'other' }
    if (chosen.condition === 'new' || chosen.condition === 'used' || chosen.condition === 'refurbished') fill.condition = chosen.condition
  }
  const price = chosen ? chosen.price ?? undefined : lines.length <= 1 || pick === 'total' ? read.total : undefined
  if (price !== undefined) {
    if (read.currency && RECEIPT_CURRENCIES.includes(read.currency)) { fill.price = price; fill.currency = read.currency }
    else if (read.currency) left.push(`The receipt is in ${read.currency}, which this app doesn't hold (NOK, TRY, EUR, USD): the amount is left out.`)
    else left.push('The receipt shows no clear currency: the amount is left out.')
  } else if (lines.length > 1 && pick == null) left.push('Several lines: pick the one you bought to fill its name and price.')
  // The receipt's extra costs go with a picked LINE (never a total: the total already holds them). Which draft carries them is the
  // caller's choice (`placeCosts`: the dearest bought line of the receipt); a lone line carries them.
  if (read.costs?.length) {
    if (chosenAt !== null) {
      if (read.currency && RECEIPT_CURRENCIES.includes(read.currency)) {
        fill.costs = read.costs.map(c => ({ kind: c.kind, label: costLabel(c), amount: c.kind === 'discount' ? -c.amount : c.amount, currency: read.currency as string }))
      } else left.push('The receipt\'s extra costs are left out: no clear currency this app holds.')
    }
  }
  if (read.date) fill.day = read.date
  if (read.searched) fill.searched = true
  if (read.channel) fill.channel = read.channel
  const parts: string[] = []
  if (read.warranty_months) {
    const until = read.date ? addMonthsToDay(read.date, read.warranty_months) : null
    if (until) fill.warrantyUntil = until
    parts.push(`${read.warranty_months} months warranty${until ? `, until ${dotDay(until)}` : ''}`)
  }
  if (chosen?.condition === 'outlet') parts.push('marked Outlet')
  if (chosen?.quantity && chosen.quantity > 1) parts.push(`${chosen.quantity} pieces on this line, the price is for all of them`)
  if (read.total !== undefined && chosen && chosen.price !== read.total) parts.push(`receipt total ${read.total}${read.currency ? ` ${read.currency}` : ''}`)
  if (parts.length) fill.note = `From the receipt: ${parts.join('; ')}.`
  return fill
}

// ── the week ──────────────────────────────────────────────────────────────────

/** Monday and Sunday (YYYY-MM-DD) of the week `day` is in. Calendar days only, so a clock change never moves it. */
export function weekBounds(day: string): { start: string; end: string } {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const back = (date.getUTCDay() + 6) % 7
  const iso = (t: Date) => t.toISOString().slice(0, 10)
  const start = new Date(date.getTime() - back * 86_400_000)
  return { start: iso(start), end: iso(new Date(start.getTime() + 6 * 86_400_000)) }
}

export interface WeekTask { title: string; status: string; completed_at: string | null; due_date?: string | null }
export interface WeekGoal { title: string; done: boolean }
/** The task rules the week reads (todo/taskRules.ts is the one place that knows them): closed, open, overdue on a day. */
export interface WeekRules {
  isClosed: (task: WeekTask) => boolean
  isOpen: (task: WeekTask) => boolean
  isOverdue: (task: WeekTask, today: string) => boolean
}

/** The local calendar day (YYYY-MM-DD) an ISO moment falls on, in the browser's own zone (Oslo for the owner). */
function localDayOfIso(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return null
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const cut = (s: string, n: number) => [...s.replace(/\s+/g, ' ').trim()].slice(0, n).join('')

/**
 * The input of "Write my week": the Work tasks closed this week (closed = done on a day, `completed_at`, never
 * `updated_at`), the Work tasks still open (the overdue ones marked, the oldest deadline first), the weekly goals and
 * the notes. Code finds and cuts; the function counts again and the model writes. The task rules come in as `rules`.
 */
export function weekInput(tasks: readonly WeekTask[], goals: readonly WeekGoal[], notes: string | null | undefined, today: string, rules: WeekRules) {
  const { start, end } = weekBounds(today)
  const closed = tasks
    .filter(t => rules.isClosed(t))
    .map(t => ({ day: localDayOfIso(t.completed_at), title: cut(t.title, 160) }))
    .filter((t): t is { day: string; title: string } => !!t.day && t.day >= start && t.day <= end && !!t.title)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 60)
  const open = tasks
    .filter(t => rules.isOpen(t) && t.title.trim())
    .map(t => ({ title: cut(t.title, 160), overdue: rules.isOverdue(t, today), due: t.due_date ?? null }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due ?? '9999').localeCompare(b.due ?? '9999'))
  return {
    week_start: start, week_end: end, closed,
    // The number of open and overdue tasks is counted here, over all of them; the list the model reads is the first 30.
    open_total: open.length, overdue_total: open.filter(t => t.overdue).length,
    open: open.slice(0, 30).map(t => ({ title: t.title, overdue: t.overdue })),
    goals: goals.filter(g => g.title.trim()).slice(0, 20).map(g => ({ done: g.done, title: cut(g.title, 160) })),
    notes: (notes ?? '').trim().slice(0, 3000),
  }
}

// ── an error, before it is sent ──────────────────────────────────────────────

const HIDDEN = '[hidden]'
const CONTEXT_SECRET_KEY = /npsso|token|secret|password|passwd|api[_-]?key|authorization|refresh|code_verifier|p256dh|cookie|session|^auth$/i

/**
 * An error's text with everything that could be a secret or a person taken out, by code, before it is put in a prompt
 * (and again on what the model writes back): the rest of a `cookie:` / `set-cookie:` / `authorization:` line, tokens of
 * every known shape (JWTs, `sk-`, `sb_…`, GitHub, Slack, AWS, Bearer), the value of any key whose name holds a secret
 * word (`webhook_secret=`, `"authToken":`, `strava_refresh_token=`, `privateKey`, `code=`, a bare `npsso abc…`), a
 * web link's query and fragment (after `scheme://`, after `host/path?`, after `/path?k=v`) and its `user:password@`,
 * e-mail addresses, phone numbers, and any long unbroken run of letters and digits. The text is scrubbed WHOLE first
 * (capped at 20,000 characters), then cut to 14 lines and to the limit, so a secret near a cut is never half kept.
 * Every pattern is bounded (no unbounded run in front of another), so a hostile text costs a few passes. Never throws.
 */
/** Text with secrets, phone numbers, e-mail addresses and links' queries taken out (the function's `scrubErrorText` does the same again; `verify-claude-function` compares them). */
export function scrubErrorForAi(text: string, maxChars: number): string {
  let t = text.slice(0, 20_000).replace(/\r\n?/g, '\n')
  // The whole rest of the line.
  t = t.replace(/\b(set-cookie|cookie|proxy-authorization|authorization)\b[ \t]*[:=][^\n]*/gi, (_a, k: string) => `${k}: ${HIDDEN}`)
  // Tokens by their shape.
  t = t.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]*)?/g, HIDDEN)
  t = t.replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, HIDDEN)
  t = t.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, HIDDEN)
  t = t.replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, HIDDEN)
  t = t.replace(/\bgithub_pat_[A-Za-z0-9_]{16,}/g, HIDDEN)
  t = t.replace(/\bxox[abprs]-[A-Za-z0-9-]{8,}/g, HIDDEN)
  t = t.replace(/\b(?:AKIA|ASIA)[0-9A-Z]{12,}/g, HIDDEN)
  t = t.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${HIDDEN}`)
  // A link: its credentials, then its query and fragment — after a scheme, after a host and path, after a bare path.
  t = t.replace(/(\b[a-z][a-z0-9+.-]{0,20}:\/\/)[^\s/@]{1,200}@/gi, `$1${HIDDEN}@`)
  t = t.replace(/(\b[a-z][a-z0-9+.-]{0,20}:\/\/[^\s?#"'<>)\]]{0,500})[?#][^\s"'<>]*/gi, `$1?${HIDDEN}`)
  t = t.replace(/(\b[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,6}\/[^\s?#"'<>)\]]{0,500})[?#][^\s"'<>]*/gi, `$1?${HIDDEN}`)
  t = t.replace(/(\/[A-Za-z0-9._~%/-]{1,500})\?[^\s"'<>]*=[^\s"'<>]*/g, `$1?${HIDDEN}`)
  // A key that names a secret, with its value (quoted or bare); the key may carry a prefix or camelCase.
  const SECRET_KEY = /api[_-]?key|token|secret|passw(?:or)?d|passphrase|private[_-]?key|credential|authorization|npsso|code[_-]?verifier|cookie|session|signature|refresh|(?:^|[_.-])(?:code|sig|pwd|otp|jwt)$/i
  t = t.replace(/(["']?)([A-Za-z0-9_.-]{1,64})(["']?)(\s*[:=]\s*)("[^"\n]{0,2000}"|'[^'\n]{0,2000}'|[^\s"',;}&]{1,2000})/g,
    (all: string, q1: string, key: string, q2: string, sep: string, value: string) => (SECRET_KEY.test(key) ? `${q1}${key}${q2}${sep}${/^["']/.test(value) ? `"${HIDDEN}"` : HIDDEN}` : all))
  // A secret word followed by a space and its value (`npsso abc123…`).
  t = t.replace(/\bnpsso[ \t]+[^\s"',;}]{4,}/gi, `npsso ${HIDDEN}`)
  t = t.replace(/\b(api[_-]?key|apikey|token|secret|password|passwd)[ \t]+(?=[A-Za-z0-9._~+/=-]{12,})(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]+/gi, `$1 ${HIDDEN}`)
  t = t.replace(/[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,}/g, '[hidden e-mail]')
  // A phone number; a date written 2026-11-22 is not one.
  t = t.replace(/\+?\d[\d -]{7,}\d/g, (m: string) => (/^\d{4}-\d{2}-\d{2}$/.test(m) ? m : '[hidden number]'))
  t = t.replace(/[A-Za-z0-9+/_=-]{32,}/g, HIDDEN)
  // Then the cut: 14 lines, then the limit.
  t = t.split('\n').slice(0, 14).join('\n').replace(/\s+\n/g, '\n').trim()
  return [...t].length > maxChars ? [...t].slice(0, maxChars).join('') : t
}

/** A logged error's context object as one scrubbed line of JSON: secret-looking keys blanked at any depth first. */
export function errorContextForAi(context: Record<string, unknown> | null | undefined, max = 2000): string {
  const blank = (v: unknown, depth: number): unknown => {
    if (depth > 6 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.slice(0, 20).map(x => blank(x, depth + 1))
    const o: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      // The browser's own description (user agent) says nothing about the failure.
      if (k === 'user_agent') continue
      o[k] = CONTEXT_SECRET_KEY.test(k) && x != null && x !== '' ? HIDDEN : blank(x, depth + 1)
    }
    return o
  }
  if (!context || Object.keys(context).length === 0) return ''
  try { return scrubErrorForAi(JSON.stringify(blank(context, 0)), max) } catch { return '' }
}

// ── Dev Requests ──────────────────────────────────────────────────────────────

const CATEGORIES = ['bug', 'feature', 'improvement', 'integration', 'longterm', 'question', 'other'] as const
const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const

export interface RequestDraft {
  title: string
  page: string
  category: (typeof CATEGORIES)[number]
  priority: (typeof PRIORITIES)[number]
  /** The points, one text each (the outline's points are separated by a blank line). */
  points: string[]
}

/**
 * A drafted request, checked again here against the app's own lists: the page only from `pages` (else "other"), the
 * category and priority only from their words. The title and points go through the same limits as the function's.
 */
export function readRequestDraft(raw: unknown, pages: readonly string[], fallbackCategory: (typeof CATEGORIES)[number] = 'feature'): RequestDraft | null {
  if (!isObj(raw)) return null
  const title = line(raw.title, 100)
  if (!title) return null
  const points: string[] = []
  if (Array.isArray(raw.points)) for (const p of raw.points.slice(0, 40)) { const t = line(p, 400); if (t && points.length < 12) points.push(t) }
  return {
    title,
    page: typeof raw.page === 'string' && pages.includes(raw.page) ? raw.page : 'other',
    category: CATEGORIES.find(c => c === raw.category) ?? fallbackCategory,
    priority: PRIORITIES.find(p => p === raw.priority) ?? 'medium',
    points,
  }
}

/** The paragraph that keeps the owner's own words under a drafted outline. */
export const SAID_PREFIX = 'Said: '

/** A description split into what is above the owner's "Said:" paragraph and the words in it (null when there is none). */
export function splitSaid(description: string): { rest: string; said: string | null } {
  const paragraphs = description.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/)
  const at = paragraphs.findIndex(p => p.startsWith(SAID_PREFIX))
  if (at < 0) return { rest: description, said: null }
  const said = paragraphs[at].slice(SAID_PREFIX.length)
  return { rest: paragraphs.filter((_, i) => i !== at).join('\n\n'), said }
}

/** The owner's words as one paragraph (blank lines inside would start new points), under the same prefix. */
export function saidBlock(said: string): string {
  return SAID_PREFIX + said.replace(/\r\n?/g, '\n').replace(/\n[ \t]*(?:\n[ \t]*)+/g, '\n').trim()
}

/** Does a description hold a Pick-on-page link or a review mark (`[[…]]`): text the AI must never send or change. */
export function hasMarks(description: string): boolean {
  return description.includes('[[')
}

/**
 * What "Tidy up" writes: the drafted points, then the owner's own words kept as typed under "Said:" (the first
 * tidy-up's words; a second one never wraps the first draft as if it were what was said).
 */
export function tidiedDescription(points: readonly string[], said: string): string {
  const block = saidBlock(said)
  return points.length ? `${points.join('\n\n')}\n\n${block}` : block
}

/** The outline text of a draft: one point per paragraph (a blank line separates points). */
export function outlineOf(points: readonly string[]): string {
  return points.join('\n\n')
}

// ── ideas ─────────────────────────────────────────────────────────────────────

/** A link, or anything that reads as a host name: never written into a wish's notes (the function's `LINKISH`, the same pattern). */
export const LINKISH = /https?:|www\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/i

/** The ideas as read back, within their limits: at most 8 lines, none with a link. */
export function readIdeas(raw: unknown): { ideas: string[]; fromSearch: boolean } | null {
  if (!isObj(raw) || !Array.isArray(raw.ideas)) return null
  const ideas: string[] = []
  for (const i of raw.ideas.slice(0, 30)) {
    const t = line(i, 200)
    if (t && !LINKISH.test(t) && !ideas.includes(t) && ideas.length < 8) ideas.push(t)
  }
  return ideas.length >= 3 ? { ideas, fromSearch: raw.from_search === true } : null
}

/** What is added to a wish's notes: a heading that says where the ideas come from, then one dash line each. */
export function ideasBlock(ideas: readonly string[], fromSearch: boolean): string {
  const head = fromSearch ? 'Ideas (found with web search):' : 'Ideas (from the model\'s general knowledge, check before you go):'
  return `${head}\n${ideas.map(i => `- ${i}`).join('\n')}`
}

/** The notes with the block added after what is already there (a blank line between). */
export function notesWithIdeas(notes: string, block: string): string {
  const t = notes.replace(/\s+$/, '')
  return t ? `${t}\n\n${block}` : block
}
