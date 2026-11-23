// Read several receipts (owner, 23.11.2026: "add option to add multiple pdf reading"): the pure rules of the queue —
// which picked files are taken, which receipt is the same as an earlier one, the lines of every file as one list, and
// the most the run could cost — worked out by code before any file is sent. One AI call per file (`receipt_read` is
// unchanged); nothing here calls anything. The file's name is shown as text only: never sent, stored or logged.
// Pure: scripts/verify-shop-receipt-batch.cjs.
import { foldName, PDF_MAX_BYTES, type ReceiptLine, type ReceiptRead } from '../ai/claude/featureRules'
import { sideOf, type ReceiptSide } from './receiptRead'

/** At most this many files in one pick (owner, 23.11.2026). */
export const RECEIPT_FILES_MAX = 5
/** The most a single file's name shows (a name is a user's own text). */
const NAME_MAX = 60
/** Searches a receipt call may run (the function's `RECEIPT_LIMITS.searches`). */
export const RECEIPT_SEARCHES = 2
/** The longest side the browser sends a photo at (`PHOTO_LONG_SIDE`), and the pixels one token covers. */
const PHOTO_SIDE = 1280
const TOKEN_SIDE = 28
/** The most prompt tokens a PDF may have before the function refuses it, and what the reservation holds for it (a quarter more). */
export const PDF_TOKENS_MAX = 32_000
const pdfHeld = (n: number) => Math.ceil(n * 1.25)
/** What one search's results add to each later round (the function's `WEB_SEARCH_RESULT_TOKENS`). */
const SEARCH_RESULT_TOKENS = 25_000
/** The words the function adds to a request: "Read the photo." / "Read the PDF.". */
const USER_TEXT = { photo: 'Read the photo.'.length, pdf: 'Read the PDF.'.length }
const PROMPT_OVERHEAD_TOKENS = 1000
/** The wrapper of the owner's category list in the prompt: "\n<categories>\n" + "\n</categories>". */
const CATEGORIES_WRAP = '\n<categories>\n'.length + '\n</categories>'.length

export interface PickedFile { name: string; type: string; size: number }
export type FileKind = 'photo' | 'pdf'

/** Whether a picked file is a PDF (its own type, or its name when the system gives none): the same rule as `isPdfFile`. */
export const isPdf = (f: PickedFile): boolean => f.type === 'application/pdf' || (f.type === '' && /\.pdf$/i.test(f.name))

/** A file's name as the screen may show it: one line, no control, zero-width or direction character, no path, cut. */
export function shownName(name: string): string {
  const t = name.replace(/[\p{Cc}\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/gu, '').replace(/^.*[\\/]/, '').replace(/\s+/g, ' ').trim()
  const chars = [...t]
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : t || 'receipt'
}

export type Refusal = { name: string; why: string }
export interface PickCheck<T extends PickedFile> { accepted: T[]; refused: Refusal[]; /** Files past the limit, not looked at. */ cut: number }

/** The browser's own check of a pick, before a file is read into memory: its type, a PDF's size, and at most `max` files. */
export function checkPicked<T extends PickedFile>(files: readonly T[], max: number = RECEIPT_FILES_MAX): PickCheck<T> {
  const accepted: T[] = []
  const refused: Refusal[] = []
  files.slice(0, max).forEach(f => {
    if (isPdf(f)) {
      if (f.size > PDF_MAX_BYTES) refused.push({ name: f.name, why: 'That PDF is too large (at most 1 MB)' })
      else if (f.size <= 0) refused.push({ name: f.name, why: 'That file is empty' })
      else accepted.push(f)
    } else if (f.type.startsWith('image/')) {
      if (f.size <= 0) refused.push({ name: f.name, why: 'That file is empty' })
      else accepted.push(f)
    } else refused.push({ name: f.name, why: 'Pick a photo or a PDF' })
  })
  return { accepted, refused, cut: Math.max(0, files.length - max) }
}

// ── the same receipt twice ───────────────────────────────────────────────────

/** Whether two reads are the same receipt: the same store, the same day and the same total — all three printed. */
export function sameReceipt(a: ReceiptRead, b: ReceiptRead): boolean {
  if (!a.store || !b.store || !a.date || !b.date || a.total === undefined || b.total === undefined) return false
  return foldName(a.store) === foldName(b.store) && a.date === b.date && Math.round(a.total * 100) === Math.round(b.total * 100)
}

/** For each read, the index of the first EARLIER read that is the same receipt, else -1 (an unread file is -1). */
export function duplicatesOf(reads: readonly (ReceiptRead | null | undefined)[]): number[] {
  return reads.map((r, i) => {
    if (!r) return -1
    for (let j = 0; j < i; j++) { const o = reads[j]; if (o && sameReceipt(o, r)) return j }
    return -1
  })
}

// ── the lines of every file, as one list ─────────────────────────────────────

export interface FileRead { id: number; read: ReceiptRead | null; duplicateOf: number }
export interface MergedLine { key: string; file: number; index: number; line: ReceiptLine; read: ReceiptRead; duplicate: boolean }

/** A line's key: its file and its place in it. A key never holds the file's name. */
export const lineKey = (file: number, index: number): string => `${file}:${index}`

/** Every read file's lines in file order, each knowing its file and whether the file is a repeat of an earlier one. */
export function mergedLines(files: readonly FileRead[]): MergedLine[] {
  return files.flatMap(f => (f.read ? (f.read.items ?? []).map((line, index) => ({ key: lineKey(f.id, index), file: f.id, index, line, read: f.read as ReceiptRead, duplicate: f.duplicateOf >= 0 })) : []))
}

/** Each line's first side: its file's `kind` (unknown reads as Bought). */
export const sidePreset = (read: ReceiptRead): ReceiptSide => sideOf(read)

// ── what the run may cost ────────────────────────────────────────────────────

export interface ReceiptPrices {
  webSearchUsdEach: number
  longPromptOverTokens: number
  longPromptMultiplier: number
  model: { cacheWrite1hPerMTok: number; outputPerMTok: number }
}

/** The photo's most tokens: the browser sends at most 1280 px on the long side (a square is the most), the function counts ⌈w/28⌉ × ⌈h/28⌉. */
export const PHOTO_TOKENS_WORST = Math.ceil(PHOTO_SIDE / TOKEN_SIDE) ** 2

/**
 * The most ONE receipt call could cost, as the function reserves it (`worstCostOf` in `runJob`): the instructions, the
 * words and the owner's category list at one token per character plus 1000, a photo at its most tokens or a PDF at what
 * the reservation holds for the largest prompt it accepts (32,000 counted, a quarter more), read again for each round of
 * a call that may run 2 searches (3 rounds, 25,000 result tokens a search so far), all at the one-hour write price, the
 * whole answer limit as output, and each search's fee. The long-prompt price is counted whenever the reads pass its line
 * (the safe side: the function applies it to one model only). The real cost is a small part of this.
 */
export function receiptWorstCost(prices: ReceiptPrices, job: { instructionsChars: number; maxOutputTokens: number }, kind: FileKind, categoriesChars = 0): number {
  const n = RECEIPT_SEARCHES
  const text = USER_TEXT[kind] + (categoriesChars > 0 ? CATEGORIES_WRAP + categoriesChars : 0)
  const fileTokens = kind === 'photo' ? PHOTO_TOKENS_WORST : pdfHeld(PDF_TOKENS_MAX)
  const prompt = job.instructionsChars + text + PROMPT_OVERHEAD_TOKENS + fileTokens
  const reads = (n + 1) * prompt + (n * (n + 1) / 2) * SEARCH_RESULT_TOKENS
  const long = reads > prices.longPromptOverTokens ? prices.longPromptMultiplier : 1
  const tokens = (reads * prices.model.cacheWrite1hPerMTok + job.maxOutputTokens * prices.model.outputPerMTok) / 1_000_000
  return Math.round((tokens * long + n * prices.webSearchUsdEach) * 1_000_000) / 1_000_000
}

/** The characters the owner's category list adds to the prompt: each row "N | path" (a character the function escapes counts 5) and a line break between rows. */
export function categoriesChars(paths: readonly string[]): number {
  return paths.reduce((sum, p, i) => sum + `${i + 1} | `.length + [...p].length + 4 * (p.match(/[&<>]/g)?.length ?? 0) + 1, 0) - (paths.length ? 1 : 0)
}

/** The most a whole queue could cost: each file at its own kind's worst case. */
export function queueWorstCost(prices: ReceiptPrices, job: { instructionsChars: number; maxOutputTokens: number }, kinds: readonly FileKind[], catChars = 0): number {
  return Math.round(kinds.reduce((sum, k) => sum + receiptWorstCost(prices, job, k, catChars), 0) * 1_000_000) / 1_000_000
}

// ── when the run stops ───────────────────────────────────────────────────────

/** A switch is off, the budget is out, the AI is not set up: asking again would only repeat it. */
const HALT_REASONS = new Set(['off', 'budget', 'not_configured'])
/** The provider's own billing sentence ("spend limit", "billing"): the same for every file. */
const BILLING = /\b(billing|spend limit|credit balance)\b/i

export type Halt = 'stop' | 'busy' | 'failed'
/** What a failed call means for the queue: `stop` ends it, `busy` waits and tries the same file again, `failed` is this file's own. */
export function haltFor(reason: string | undefined, message: string): Halt {
  if (reason && HALT_REASONS.has(reason)) return 'stop'
  if (reason === 'busy') return 'busy'
  if (BILLING.test(message)) return 'stop'
  return 'failed'
}

/** Two failed files in a row end the queue: a broken key or a down service would repeat for every file. */
export const FAILS_IN_A_ROW = 2

// ── do the lines and the costs add up to the receipt's total? ────────────────

export interface ReceiptSums { lines: number; costs: number; sum: number; total: number; differs: boolean; doubled: boolean }

/**
 * The product lines plus the extra costs (a discount counts as minus) against the receipt's printed total, in the receipt's own
 * numbers. Null when there is nothing to compare (no total, no lines, or a line with no price). `differs` from a whole unit
 * (rounding is kept out); `doubled` when the sum is LOWER than the total by about one of the discounts — a discount counted twice
 * (the line prices are already after it and it was taken off again).
 */
export function receiptSums(read: ReceiptRead): ReceiptSums | null {
  const items = read.items ?? []
  if (read.total === undefined || items.length === 0 || items.some(l => l.price == null)) return null
  const lines = Math.round(items.reduce((n, l) => n + (l.price as number), 0) * 100) / 100
  const costs = Math.round((read.costs ?? []).reduce((n, c) => n + (c.kind === 'discount' ? -c.amount : c.amount), 0) * 100) / 100
  const sum = Math.round((lines + costs) * 100) / 100
  const diff = Math.round((sum - read.total) * 100) / 100
  const discounts = [...items.flatMap(l => (l.discount !== undefined ? [l.discount] : [])), ...(read.costs ?? []).filter(c => c.kind === 'discount').map(c => c.amount)]
  return { lines, costs, sum, total: read.total, differs: Math.abs(diff) > 1, doubled: diff < -1 && discounts.some(d => Math.abs(Math.abs(diff) - d) <= 1) }
}
