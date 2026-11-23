// Sorting a typed or pasted text into quick-list items (owner, 23.11.2026: "ai list for quick list … the ai will resolve and
// polish it to separate items"). Pure: scripts/verify-quick-list-ai.cjs checks it.
//
// AI last: `planQuickText` is what CODE does first. A text that already splits on commas, semicolons or lines, where every
// piece is a short plain item ("2x egg", "2 kg ris"), becomes the items with no model at all. Only text code cannot split
// with certainty (words run together with no comma, "and", "some … for pizza", digits in the middle) goes to the
// `quick_list_parse` job. Code cannot know a typo, so a split text keeps its words as typed; only a first letter in
// capitals is fixed. Whatever the model answers is checked again here by `readQuickItems` (the same rules as the function).
// The words are the owner's own: saved as typed, never translated.
//
// The part between the markers is the same text as in supabase/claude-src/job-quick-list.ts.

import { quickAddInput } from './shopModel'
import type { CreateShopItemInput } from './types'

// <quick-list-shared>
// One copy here, one in src/features/shop/quickParseRules.ts: edit both (scripts/verify-quick-list-ai.cjs compares the text).
// The text is the owner's own words, and may be pasted from a hostile page: it is data, checked on the way in and again
// on the way out. The answer can only be items whose words the text already holds.
export const QUICK_LIMITS = { text: 1000, items: 30, name: 60, unit: 10, quantity: 999 } as const

/** One thing to buy: a name, and a quantity (and its unit) only when the text wrote one. */
export interface QuickItem { name: string; quantity?: number; unit?: string }

// Control characters other than tab and line breaks, and the zero-width and text-direction ones: they draw nothing and can hide a link.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is looked for
const QUICK_HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/
/** A web address in a text that must be plain words; a name that trips it is refused, the safe side. */
const QUICK_LINKISH = /https?:|:\/\/|www\.|mailto:|\b[a-z0-9-]+\.[a-z]{2,}\b/i

/** Why a text cannot be sorted (the owner's sentence), or null. */
export function quickTextProblem(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return 'Write what you need first.'
  if ([...text.trim()].length > QUICK_LIMITS.text) return `Keep the text to ${QUICK_LIMITS.text} characters.`
  if (QUICK_HIDDEN.test(text)) return 'The text has hidden characters. Retype it as plain text.'
  if (QUICK_LINKISH.test(text)) return 'The text has a link in it. Take links out first; only plain words are sorted.'
  return null
}

const quickFold = (s: string): string => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss')
/** Letters and numbers, apart ("1l" is "1", "l"; "2x" is "2", "x"), accents and case gone. */
const quickTokens = (s: string): string[] => quickFold(s).match(/\p{L}+|\d+(?:[.,]\d+)?/gu) ?? []

/** Edits between two words (a swap of neighbours counts once), or max + 1 when it is more than `max`. */
function quickDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
    }
  }
  return d[a.length][b.length]
}
/** The same word within a typo: none for 2 letters or fewer, one edit up to 5, two from 6. */
function quickNear(a: string, b: string): boolean {
  const longest = Math.max(a.length, b.length)
  const allowed = longest <= 2 ? 0 : longest <= 5 ? 1 : 2
  return quickDistance(a, b, allowed) <= allowed
}

/** True when every word of the name is a word of the text (typos allowed, neighbours run together allowed), or the name as one run is a run of the text's words: nothing in the name is new. */
function quickGrounded(name: string, textTokens: readonly string[]): boolean {
  const words = quickTokens(name).filter(w => /\p{L}/u.test(w) && w.length >= 2)
  if (!words.length) return false
  const letters = textTokens.filter(t => /\p{L}/u.test(t))
  const spans: string[] = []
  for (let i = 0; i < letters.length; i++) {
    let run = ''
    for (let n = 0; n < 4 && i + n < letters.length; n++) { run += letters[i + n]; spans.push(run) }
  }
  if (words.every(w => spans.some(s => quickNear(w, s)))) return true
  const joined = words.join('')
  return spans.some(s => quickNear(joined, s))
}

/** A name for the list: one plain line of at most 60 characters, no link, no angle brackets; null when it is none. */
function quickName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(new RegExp(QUICK_HIDDEN.source, 'g'), '').replace(/\s+/g, ' ').trim()
  if (!text || [...text].length > QUICK_LIMITS.name || /[<>]/.test(text) || QUICK_LINKISH.test(text)) return null
  return text
}

const quickOwn = (from: unknown, key: string): unknown =>
  from !== null && typeof from === 'object' && Object.prototype.hasOwnProperty.call(from, key) ? (from as Record<string, unknown>)[key] : undefined

/**
 * The items of a model's answer, each checked: a name that the text does not hold is dropped (nothing is invented), a
 * quantity only when that number is written in the text, a unit only when the text writes it ("x" is no unit), at most
 * 30 items, a name once. A value that fails is dropped, never repaired.
 */
export function readQuickItems(raw: unknown, text: string): QuickItem[] {
  const list = quickOwn(raw, 'items')
  if (!Array.isArray(list)) return []
  const tokens = quickTokens(text)
  const numbers = tokens.filter(t => /^\d/.test(t)).map(t => Number(t.replace(',', '.')))
  const seen = new Set<string>()
  const out: QuickItem[] = []
  for (const row of list.slice(0, QUICK_LIMITS.items)) {
    const name = quickName(quickOwn(row, 'name'))
    if (!name || !quickGrounded(name, tokens)) continue
    const key = quickFold(name).replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    const item: QuickItem = { name }
    const q = quickOwn(row, 'quantity')
    if (typeof q === 'number' && Number.isFinite(q) && q > 0 && q <= QUICK_LIMITS.quantity) {
      const rounded = Math.round(q * 100) / 100
      if (numbers.some(n => Math.abs(n - rounded) < 0.005)) {
        item.quantity = rounded
        const u = quickOwn(row, 'unit')
        const unit = typeof u === 'string' ? u.trim() : ''
        const bare = quickFold(unit.replace(/\.$/, ''))
        if (/^\p{L}{1,10}\.?$/u.test(unit) && bare !== 'x' && tokens.includes(bare)) item.unit = unit
      }
    }
    out.push(item)
  }
  return out
}
// </quick-list-shared>

// ── What code does before the model ──────────────────────────────────────────

/** Words that join or pad: a piece holding one is not one plain item, so the model reads the text. */
const JOINERS = new Set(['and', 'og', 'or', 'eller', 'plus', 'some', 'litt', 'noen', 'for', 'til', 'with', 'med', '&', '+'])
/** Units code reads beside a number ("2 kg ris", "500g ost"); "x" is a sign for times, never a unit. */
const CODE_UNITS = new Set(['kg', 'g', 'l', 'dl', 'ml', 'pk', 'stk', 'pcs', 'x', '×'])
const PIECE_WORDS_MAX = 4
const BULLET = /^\s*(?:[-*•·–]|\d+[.)])\s+/

export type QuickPlan =
  /** Code split it: these are the items, no model asked. */
  | { kind: 'code'; items: QuickItem[] }
  /** Code could not be sure: the model reads the text. */
  | { kind: 'ai' }
  /** More than 30 pieces. */
  | { kind: 'toomany' }
  /** Only separators. */
  | { kind: 'empty' }

/** A piece of the text as one item, or null when it is more than one plain item. */
function pieceItem(piece: string, alone: boolean): QuickItem | null {
  const tokens = piece.split(/\s+/).filter(Boolean)
  let quantity: number | undefined
  let unit: string | undefined
  const lead = /^(\d{1,3}(?:[.,]\d{1,2})?)([\p{L}×]*)$/u.exec(tokens[0] ?? '')
  if (lead) {
    quantity = Number(lead[1].replace(',', '.'))
    if (!(quantity > 0 && quantity <= QUICK_LIMITS.quantity)) return null
    tokens.shift()
    let suffix = lead[2].toLowerCase()
    if (!suffix && tokens.length > 1 && CODE_UNITS.has(tokens[0].toLowerCase())) suffix = (tokens.shift() as string).toLowerCase()
    if (suffix) {
      if (!CODE_UNITS.has(suffix)) return null
      if (suffix !== 'x' && suffix !== '×') unit = suffix
    }
  }
  if (tokens.length < 1 || tokens.length > PIECE_WORDS_MAX || (alone && tokens.length > 1)) return null
  if (tokens.some(t => JOINERS.has(t.toLowerCase()) || /\d/.test(t))) return null
  const name = quickName(tokens.join(' '))
  if (!name) return null
  const letters = name.replace(/[^\p{L}]/gu, '')
  const lower = letters === letters.toLowerCase()
  const shouting = letters === letters.toUpperCase() && letters.length >= 6
  const cased = lower ? name.charAt(0).toUpperCase() + name.slice(1) : shouting ? name.charAt(0) + name.slice(1).toLowerCase() : name
  return { name: cased, ...(quantity !== undefined ? { quantity } : {}), ...(unit ? { unit } : {}) }
}

/** What to do with a text that passed `quickTextProblem`: split it by code, or send it to the model. */
export function planQuickText(text: string): QuickPlan {
  const pieces = text.split(/[\n\r;,]+/).map(p => p.replace(BULLET, '').trim()).filter(Boolean)
  if (pieces.length === 0) return { kind: 'empty' }
  if (pieces.length > QUICK_LIMITS.items) return { kind: 'toomany' }
  const items: QuickItem[] = []
  for (const piece of pieces) {
    // One piece with no comma or line break could be one thing or several ("toalettpapir oppvaskmiddel"): one word only.
    const item = pieceItem(piece, pieces.length === 1)
    if (!item) return { kind: 'ai' }
    items.push(item)
  }
  return { kind: 'code', items }
}

// ── The review and the write ─────────────────────────────────────────────────

/** The amount line of an item as the review shows it and the row's note keeps it: "2 kg", or "×2" with no unit. */
export function quickAmountText(item: QuickItem): string {
  if (item.quantity === undefined) return ''
  return item.unit ? `${item.quantity} ${item.unit}` : `×${item.quantity}`
}

/** One line of the review: ticked, with the owner's own edits of the name and the amount. */
export interface QuickReviewRow { key: number; on: boolean; name: string; amount: string }

export const QUICK_AMOUNT_MAX = 20

export function quickReviewRows(items: readonly QuickItem[]): QuickReviewRow[] {
  return items.map((item, key) => ({ key, on: true, name: item.name, amount: quickAmountText(item) }))
}

/** A typed value as one plain line of at most `max` characters (control and hidden characters out). */
function typedLine(value: string, max: number): string {
  return [...value.replace(new RegExp(QUICK_HIDDEN.source, 'g'), ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('')
}

/** The rows the batch add takes: the ticked lines with a name; the amount goes in the row's note. */
export function quickReviewInputs(rows: readonly QuickReviewRow[], store: string): CreateShopItemInput[] {
  return rows.flatMap(r => {
    const title = r.on ? typedLine(r.name, QUICK_LIMITS.name) : ''
    if (!title) return []
    const amount = typedLine(r.amount, QUICK_AMOUNT_MAX)
    return [{ ...quickAddInput({ title, store }), ...(amount ? { notes: amount } : {}) }]
  })
}

// ── The cost ─────────────────────────────────────────────────────────────────

/** The prices the estimate reads, as `describe` gives them. */
export interface QuickPrices {
  longPromptOverTokens: number
  longPromptMultiplier: number
  model: { cacheWrite1hPerMTok: number; outputPerMTok: number }
}

/**
 * The most ONE call could cost, as the function reserves it (`worstCostOf`, no search): the prompt at one token per
 * character plus 1000, all at the one-hour write price, the whole answer limit as output, the long-prompt price when the
 * prompt passes its line. The text counts as it is sent (& < > written out). The real cost is a small part of this.
 */
export function quickWorstCost(prices: QuickPrices, instructionsChars: number, text: string, maxOutputTokens: number): number {
  const sent = text.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').length + '<text>\n\n</text>'.length
  const prompt = instructionsChars + sent + 1000
  const long = prompt > prices.longPromptOverTokens ? prices.longPromptMultiplier : 1
  const dollars = (prompt * prices.model.cacheWrite1hPerMTok + maxOutputTokens * prices.model.outputPerMTok) / 1_000_000
  return Math.round(dollars * long * 1_000_000) / 1_000_000
}
