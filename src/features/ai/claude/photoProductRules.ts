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
/** One plain line within `max` that is no web address; zero-width and text-direction characters out first. */
function photoWord(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim()
  return t && [...t].length <= max && !PHOTO_LINKISH.test(t) ? t : null
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
export function photoPlan(text: string): { kind: 'link' } | { kind: 'barcode'; code: string } | { kind: 'ai' } {
  const t = text.replace(/\s+/g, ' ').trim()
  if (/https?:\/\/|www\./i.test(t)) return { kind: 'link' }
  const digits = t.replace(/[\s-]/g, '')
  if (/^\d{8,14}$/.test(digits)) return { kind: 'barcode', code: digits }
  return { kind: 'ai' }
}
