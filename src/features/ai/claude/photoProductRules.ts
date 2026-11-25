// Pure rules of Shop's 📷✨ (a thing from photos, the `product_photo` job, owner, 25.11.2026): the app's second check of the
// function's answer, and what code does before any call (AI last). Its own module, loaded with the Shop's autofill, so the
// pages that import the other AI features (Work, Settings) never carry it. scripts/verify-shop-photo.cjs runs it.
import { pageLink, RECEIPT_CURRENCIES } from './featureRules'

/** The most bytes each of the two photos may have: two of them, base64, stay inside the function's 1.5 MB body (≤ 700 000 characters each). */
export const PRODUCT_PHOTO_MAX_BYTES = 500_000
/** At most two photos, a line of at most 300 characters, at most 3 answers of at most 120. The function's `PRODUCT_PHOTO_LIMITS`. */
export const PRODUCT_PHOTO_LIMITS = { photos: 2, text: 300, answers: 3, answer: 120, question: 120, choice: 40 } as const

/** One question the AI asked, with 2–4 answers to tap (the owner may type another). */
export interface PhotoQuestion { question: string; choices: string[] }
/** The draft the AI made from the photos: every field optional but one of name, brand and model. */
export interface PhotoDraft {
  name?: string
  brand?: string
  model?: string
  /** One of the categories the app sent (never anything else). */
  category_id?: string
  condition?: 'new' | 'used' | 'refurbished'
  /** A printed price with its currency, only a currency this app holds. */
  price?: number
  currency?: string
  /** Pages to try for the product's picture (addresses the function's own search returned): read through shop-price only. */
  page_urls?: string[]
  page_named?: boolean
  /** The call really searched the web (its own count). */
  searched?: boolean
}
export type PhotoAnswer = { kind: 'questions'; questions: PhotoQuestion[]; searched: boolean } | { kind: 'draft'; draft: PhotoDraft }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
/** A web address or a path in a plain text (the function's `PHOTO_LINKISH`): never a name, a question or a choice. */
const PHOTO_LINKISH = /https?:|www\.|^\/|\/\/|\b[a-z0-9-]+\.[a-z]{2,}\b/i
/**
 * A text as the function reads it (`cleanedText`): white space made one space, then every format or control character
 * (zero-width, direction marks, soft hyphens, word joiners) taken out, so a link split by one is whole again for the checks.
 */
export function cleanedText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/[\p{Cf}\p{Cc}]/gu, '').trim()
}
/** A link, also in full-width letters (the function's `holdsLink`): never in the line or an answer that is sent. */
export const holdsLink = (text: string): boolean => /https?:\/\/|www\./i.test(cleanedText(text).normalize('NFKC'))
/** One plain line within `max` that is no web address, cleaned first. */
function photoWord(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = cleanedText(v)
  return t && [...t].length <= max && !PHOTO_LINKISH.test(t) && !PHOTO_LINKISH.test(t.normalize('NFKC')) ? t : null
}
const amount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0.01 && v <= 5_000_000 ? Math.round(v * 100) / 100 : null)

/**
 * The function's answer, checked again with the same limits: questions (1–3, each with 2–4 distinct choices) or a draft with
 * a name, a brand or a model; a category only of `categoryIds` (the ones this app sent), a page only a plain https link, a
 * price only with a currency this app holds. A value that fails is dropped, never repaired; null when nothing usable is left.
 */
export function readProductPhoto(raw: unknown, categoryIds: ReadonlySet<string>): PhotoAnswer | null {
  if (!isObj(raw)) return null
  const searched = raw.searched === true
  if (raw.kind === 'questions') {
    const questions: PhotoQuestion[] = []
    for (const q of Array.isArray(raw.questions) ? raw.questions.slice(0, 10) : []) {
      if (!isObj(q)) continue
      const question = photoWord(q.question, PRODUCT_PHOTO_LIMITS.question)
      const choices: string[] = []
      for (const c of Array.isArray(q.choices) ? q.choices.slice(0, 10) : []) {
        const choice = photoWord(c, PRODUCT_PHOTO_LIMITS.choice)
        if (choice && !choices.some(x => x.toLowerCase() === choice.toLowerCase()) && choices.length < 4) choices.push(choice)
      }
      if (question && choices.length >= 2 && questions.length < 3) questions.push({ question, choices })
    }
    return questions.length ? { kind: 'questions', questions, searched } : null
  }
  if (raw.kind !== 'draft') return null
  const draft: PhotoDraft = {}
  const name = photoWord(raw.name, 120), brand = photoWord(raw.brand, 60), model = photoWord(raw.model, 60)
  if (name) draft.name = name
  if (brand) draft.brand = brand
  if (model) draft.model = model
  if (!name && !brand && !model) return null
  if (typeof raw.category_id === 'string' && categoryIds.has(raw.category_id)) draft.category_id = raw.category_id
  if (raw.condition === 'new' || raw.condition === 'used' || raw.condition === 'refurbished') draft.condition = raw.condition
  const price = amount(raw.price)
  if (price !== null && typeof raw.currency === 'string' && RECEIPT_CURRENCIES.includes(raw.currency)) { draft.price = price; draft.currency = raw.currency }
  const pages = (Array.isArray(raw.page_urls) ? raw.page_urls : []).slice(0, 3).map(pageLink).filter((x): x is string => !!x)
  if (pages.length) { draft.page_urls = pages; draft.page_named = raw.page_named === true }
  if (searched) draft.searched = true
  return { kind: 'draft', draft }
}

/**
 * AI last, before any photo is sent: a link in the line is the link reader's (free), a typed barcode number the barcode
 * lookup's (free; the Scan button reads one from the camera); only the rest goes to the AI.
 */
export function photoPlan(text: string): { kind: 'link'; url: string | null; rest: string } | { kind: 'barcode'; code: string } | { kind: 'ai' } {
  const t = cleanedText(text).normalize('NFKC')
  if (/https?:\/\/|www\./i.test(t)) {
    // Just the link (a "www." one made https), read alone; the words around it stay in the line.
    const found = /(?:https?:\/\/|www\.)[^\s<>"']+/i.exec(t)
    const raw = found ? found[0].replace(/[.,;:!?)\]]+$/, '') : ''
    const url = webAddress(/^www\./i.test(raw) ? `https://${raw}` : raw)
    return { kind: 'link', url, rest: found ? t.replace(found[0], ' ').replace(/\s+/g, ' ').trim() : t }
  }
  const digits = t.replace(/[\s-]/g, '')
  if (/^\d{8,14}$/.test(digits)) return { kind: 'barcode', code: digits }
  return { kind: 'ai' }
}

/** A plain web address (http or https, a dotted host, no user or password) as the URL parser writes it, or null. */
function webAddress(text: string): string | null {
  try {
    const u = new URL(text)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') && !u.username && !u.password ? u.href : null
  } catch { return null }
}

/** A barcode a reader gave (a still photo, the camera) as the job takes it: 8–14 digits, else none. */
export function photoEan(code: string | null | undefined): string | null {
  const digits = (code ?? '').replace(/\D/g, '')
  return /^\d{8,14}$/.test(digits) && digits === (code ?? '').trim() ? digits : null
}

/** What the screens say. */
export const PHOTO_WORDS = {
  twoAtMost: 'Two photos at most — remove one first',
  answerLink: 'An answer can\'t be a link — type the words',
  notReady: 'The link reader is still loading — try again in a moment',
} as const

// ── what both calls may cost ─────────────────────────────────────────────────

/** A photo's most tokens: the browser sends at most 1280 px on the long side (a square is the most), ⌈w/28⌉ × ⌈h/28⌉. */
export const PHOTO_TOKENS_EACH_WORST = Math.ceil(1280 / 28) ** 2
/** The most the live text adds (the line, three answers with their questions, the tags), in characters. */
const PHOTO_TEXT_WORST = 300 + 3 * (120 + 120 + 8) + 200

export interface PhotoPrices {
  webSearchUsdEach: number
  longPromptOverTokens: number
  longPromptMultiplier: number
  model: { cacheWrite1hPerMTok: number; outputPerMTok: number }
}

/**
 * The most the two calls (questions, then the draft) could cost, as the function reserves each (`worstCostOf`): the
 * instructions, the live text and the category list at one token per character plus 1000, two photos at their most tokens,
 * read again for each of the 3 rounds a 2-search call may take (25,000 result tokens a search so far), at the one-hour write
 * price, the whole answer limit as output and each search's fee. Shown on Ask; the real cost is a small part of it.
 */
export function photoWorstCost(prices: PhotoPrices, job: { instructionsChars: number; maxOutputTokens: number }, categoryChars: number): number {
  const n = 2
  const prompt = job.instructionsChars + PHOTO_TEXT_WORST + categoryChars + 1000 + 2 * PHOTO_TOKENS_EACH_WORST
  const reads = (n + 1) * prompt + (n * (n + 1) / 2) * 25_000
  const long = reads > prices.longPromptOverTokens ? prices.longPromptMultiplier : 1
  const one = ((reads * prices.model.cacheWrite1hPerMTok + job.maxOutputTokens * prices.model.outputPerMTok) / 1_000_000) * long + n * prices.webSearchUsdEach
  return Math.round(2 * one * 1_000_000) / 1_000_000
}
