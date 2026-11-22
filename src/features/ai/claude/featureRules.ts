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

// ── receipt ───────────────────────────────────────────────────────────────────

export const RECEIPT_CURRENCIES: readonly string[] = ['NOK', 'TRY', 'EUR', 'USD']
const AMOUNT_MAX = 5_000_000

export interface ReceiptLine { name: string; price: number | null }
export interface ReceiptRead {
  store?: string
  /** YYYY-MM-DD */
  date?: string
  currency?: string
  total?: number
  items?: ReceiptLine[]
  warranty_months?: number
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const line = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(/\s+/g, ' ').trim()
  return t && [...t].length <= max ? t : null
}
const amount = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0.01 && v <= AMOUNT_MAX ? Math.round(v * 100) / 100 : null)

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
export function readReceipt(raw: unknown, today: string): ReceiptRead | null {
  if (!isObj(raw)) return null
  const out: ReceiptRead = {}
  const store = line(raw.store, 80)
  if (store && !/https?:|www\.|\//i.test(store)) out.store = store
  const date = realDay(raw.date)
  if (date && date <= today && date >= `${Number(today.slice(0, 4)) - 5}${today.slice(4)}`) out.date = date
  if (typeof raw.currency === 'string' && /^[A-Z]{3}$/.test(raw.currency)) out.currency = raw.currency
  const total = amount(raw.total)
  if (total !== null) out.total = total
  const items: ReceiptLine[] = []
  if (Array.isArray(raw.items)) {
    for (const it of raw.items.slice(0, 30)) {
      if (!isObj(it)) continue
      const name = line(it.name, 120)
      if (name && items.length < 8) items.push({ name, price: amount(it.price) })
    }
  }
  if (items.length) out.items = items
  if (typeof raw.warranty_months === 'number' && Number.isInteger(raw.warranty_months) && raw.warranty_months >= 1 && raw.warranty_months <= 120) out.warranty_months = raw.warranty_months
  return Object.keys(out).length ? out : null
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
  price?: number
  currency?: string
  day?: string
  /** The owner's own store it matched, or null; `storeName` is what is printed when none matched. */
  storeId: string | null
  storeName: string | null
  /** A line for the receipt note: what was read and could not go in a field (a warranty, a currency this app doesn't hold). */
  note: string
  /** Why a value was left out, in a sentence for the owner. */
  left: string[]
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

/**
 * The form fields a read receipt fills. `pick` is the item line the owner chose (a receipt of many lines is never
 * guessed at): its price is the amount paid; a receipt of one line takes that line, and with no line the total is
 * the amount. An amount in a currency this app doesn't hold is left out (never converted or relabelled).
 */
export function receiptFill(read: ReceiptRead, stores: readonly { id: string; name: string; hidden?: boolean; kind?: string }[], pick: number | null | 'total'): ReceiptFill {
  const left: string[] = []
  const lines = read.items ?? []
  const chosen = pick === 'total' ? null : typeof pick === 'number' ? lines[pick] ?? null : lines.length === 1 ? lines[0] : null
  const fill: ReceiptFill = { storeId: null, storeName: null, note: '', left }
  if (chosen) fill.title = chosen.name
  const price = chosen ? chosen.price ?? undefined : lines.length <= 1 || pick === 'total' ? read.total : undefined
  if (price !== undefined) {
    if (read.currency && !RECEIPT_CURRENCIES.includes(read.currency)) left.push(`The receipt is in ${read.currency}, which this app doesn't hold (NOK, TRY, EUR, USD): the amount is left out.`)
    else if (!read.currency) left.push('The receipt shows no clear currency: the amount is filled, check the currency.')
    if (!read.currency || RECEIPT_CURRENCIES.includes(read.currency)) {
      fill.price = price
      if (read.currency) fill.currency = read.currency
    }
  } else if (lines.length > 1 && pick == null) left.push('Several lines: pick the one you bought to fill its name and price.')
  if (read.date) fill.day = read.date
  const store = matchStore(read.store, stores)
  if (store) fill.storeId = store.id
  else if (read.store) fill.storeName = read.store
  const parts: string[] = []
  if (read.warranty_months) parts.push(`warranty on the receipt: ${read.warranty_months} months${read.date ? ` (until ${dotDay(addMonthsToDay(read.date, read.warranty_months))})` : ''}`)
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

export interface WeekTask { title: string; status: string; completed_at: string | null }
export interface WeekGoal { title: string; done: boolean }

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
 * `updated_at`), the weekly goals, the notes. Code finds and cuts; the function counts again and the model writes.
 * `closedStatuses` is what the task rules call closed.
 */
export function weekInput(tasks: readonly WeekTask[], goals: readonly WeekGoal[], notes: string | null | undefined, today: string, isClosed: (status: string) => boolean) {
  const { start, end } = weekBounds(today)
  const closed = tasks
    .filter(t => isClosed(t.status))
    .map(t => ({ day: localDayOfIso(t.completed_at), title: cut(t.title, 160) }))
    .filter((t): t is { day: string; title: string } => !!t.day && t.day >= start && t.day <= end && !!t.title)
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 60)
  return {
    week_start: start, week_end: end, closed,
    goals: goals.filter(g => g.title.trim()).slice(0, 20).map(g => ({ done: g.done, title: cut(g.title, 160) })),
    notes: (notes ?? '').trim().slice(0, 3000),
  }
}

// ── an error, before it is sent ──────────────────────────────────────────────

const HIDDEN = '[hidden]'
const SECRET_KEY = /npsso|token|secret|password|passwd|api[_-]?key|authorization|refresh|code_verifier|p256dh|cookie|session|^auth$/i

/** Text with secrets, links' query strings, e-mail addresses and long keys taken out (the function does the same again). */
export function scrubErrorForAi(text: string, max: number): string {
  let t = text.replace(/\r\n?/g, '\n').split('\n').slice(0, 14).join('\n')
  t = t.replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}(?:\.[A-Za-z0-9_-]*)?/g, HIDDEN)
  t = t.replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/gi, HIDDEN)
  t = t.replace(/\bsk-[A-Za-z0-9_-]{8,}/g, HIDDEN)
  t = t.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${HIDDEN}`)
  t = t.replace(/(https?:\/\/)([^\s/@:]+:[^\s/@]*@)?([^\s?#"'<>)\]]*)[?#][^\s"'<>)\]]*/gi, (_all, scheme: string, _auth: string | undefined, rest: string) => `${scheme}${rest}?${HIDDEN}`)
  t = t.replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]*@/gi, `$1${HIDDEN}@`)
  t = t.replace(/\b(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|token|secret|client[_-]?secret|password|passwd|authorization|npsso|code[_-]?verifier|cookie|session)\b(["']?\s*[:=]\s*)(["']?)[^\s"',;}&]+/gi, (_a, k: string, sep: string, q: string) => `${k}${sep}${q}${HIDDEN}`)
  t = t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[hidden e-mail]')
  t = t.replace(/[A-Za-z0-9+/_=-]{32,}/g, HIDDEN)
  t = t.replace(/\s+\n/g, '\n').trim()
  return [...t].length > max ? [...t].slice(0, max).join('') : t
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
      o[k] = SECRET_KEY.test(k) && x != null && x !== '' ? HIDDEN : blank(x, depth + 1)
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

/** The outline text of a draft: one point per paragraph (a blank line separates points). */
export function outlineOf(points: readonly string[]): string {
  return points.join('\n\n')
}

// ── ideas ─────────────────────────────────────────────────────────────────────

/** The ideas as read back, within their limits: at most 8 lines, none with a link. */
export function readIdeas(raw: unknown): { ideas: string[]; fromSearch: boolean } | null {
  if (!isObj(raw) || !Array.isArray(raw.ideas)) return null
  const ideas: string[] = []
  for (const i of raw.ideas.slice(0, 30)) {
    const t = line(i, 200)
    if (t && !/https?:|www\./i.test(t) && !ideas.includes(t) && ideas.length < 8) ideas.push(t)
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
