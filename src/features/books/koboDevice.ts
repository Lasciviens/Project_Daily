// What the Kobo sends besides reading rows — captures and passage questions.
// Pure and import-free, GENERATED into supabase/functions/kobo-sync by
// scripts/sync-kobo-shared.mjs and verified by scripts/verify-kobo-settings.cjs.

// ── Capture: a note typed on the Kobo becomes a task, a wish or a book ──────

export type CaptureKind = 'task' | 'wish' | 'book'
export interface Capture { id: string; kind: CaptureKind; text: string; note: string | null; book: string | null }

const CAPTURE_ID = /^[A-Za-z0-9-]{8,64}$/

/** The usable captures of a request (at most 50), each trimmed and capped. */
export function cleanCaptures(raw: unknown): Capture[] {
  if (!Array.isArray(raw)) return []
  const out: Capture[] = []
  const seen = new Set<string>()
  for (const r of raw.slice(0, 50)) {
    const x = r as Record<string, unknown>
    if (!x || typeof x.id !== 'string' || !CAPTURE_ID.test(x.id) || seen.has(x.id)) continue
    if (x.kind !== 'task' && x.kind !== 'wish' && x.kind !== 'book') continue
    const text = typeof x.text === 'string' ? x.text.replace(/\s+/g, ' ').trim().slice(0, 300) : ''
    if (!text) continue
    const note = typeof x.note === 'string' && x.note.trim() ? x.note.trim().slice(0, 2000) : null
    const book = typeof x.book === 'string' && x.book.trim() ? x.book.trim().slice(0, 200) : null
    seen.add(x.id)
    out.push({ id: x.id, kind: x.kind, text, note, book })
  }
  return out
}

/** The note a captured row carries: the passage (if any) and where it came from. */
export function captureNote(c: Capture): string {
  const from = c.book ? `Captured on the Kobo while reading “${c.book}”.` : 'Captured on the Kobo.'
  return c.note ? `“${c.note}”\n\n${from}` : from
}

/** "Title — Author" or "Title by Author" typed for a book capture → title and author. */
export function splitBookCapture(text: string): { title: string; author: string | null } {
  const m = text.match(/^(.+?)\s+(?:—|–|-|by)\s+(.+)$/i)
  if (m && m[1].trim() && m[2].trim()) return { title: m[1].trim(), author: m[2].trim() }
  return { title: text.trim(), author: null }
}

// ── Ask about a passage ─────────────────────────────────────────────────────

export type AskKind = 'explain' | 'translate' | 'word' | 'character' | 'free'
export const ASK_KINDS: AskKind[] = ['explain', 'translate', 'word', 'character', 'free']

export interface AskInput {
  ask: AskKind
  selection: string
  before: string
  after: string
  question: string | null
  title: string | null
  author: string | null
  language: string | null
  percent: number | null
  answer_language: string
}

const LANGUAGES = ['English', 'Turkish', 'Norwegian']

/** The question as the server accepts it, or an error message. */
export function cleanAsk(raw: unknown): AskInput | string {
  const x = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')
  const ask = ASK_KINDS.includes(x.ask as AskKind) ? x.ask as AskKind : null
  if (!ask) return 'Unknown question type.'
  const selection = s(x.selection, 1500)
  if (!selection) return 'Select some text first.'
  const question = s(x.question, 500) || null
  if (ask === 'free' && !question) return 'Type a question.'
  const pct = typeof x.percent === 'number' && Number.isFinite(x.percent) ? Math.min(100, Math.max(0, x.percent)) : null
  const lang = LANGUAGES.includes(x.answer_language as string) ? x.answer_language as string : 'English'
  return {
    ask, selection, question,
    before: s(x.before, 600), after: s(x.after, 600),
    title: s(x.title, 200) || null, author: s(x.author, 200) || null, language: s(x.language, 20) || null,
    percent: pct, answer_language: lang,
  }
}

/** The model's text, trimmed to what an e-ink box shows well (kobo-sync applies it again to what the `claude` function answered). */
export function cleanAnswer(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
  return t ? t.slice(0, 2500) : null
}

// ── Device facts sent with a sync ───────────────────────────────────────────

export interface DeviceFacts {
  battery?: number
  charging?: boolean
  koreader_version?: string
  storage_total?: number
  storage_free?: number
  storage_at?: string
}

/** Battery, KOReader version and the user storage the plugin sends with a sync (anything odd is dropped). */
export function cleanDeviceFacts(raw: Record<string, unknown>, nowIso?: string): DeviceFacts {
  const out: DeviceFacts = {}
  if (typeof raw.battery === 'number' && Number.isFinite(raw.battery) && raw.battery >= 0 && raw.battery <= 100) out.battery = Math.round(raw.battery)
  if (typeof raw.charging === 'boolean') out.charging = raw.charging
  if (typeof raw.koreader_version === 'string' && raw.koreader_version.trim()) out.koreader_version = raw.koreader_version.trim().slice(0, 40)
  const total = raw.storage_total
  const free = raw.storage_free
  // Up to 4 TB; free never more than total.
  if (typeof total === 'number' && typeof free === 'number' && Number.isFinite(total) && Number.isFinite(free)
    && total > 0 && total <= 4 * 1024 ** 4 && free >= 0 && free <= total) {
    out.storage_total = Math.round(total)
    out.storage_free = Math.round(free)
    if (nowIso) out.storage_at = nowIso
  }
  return out
}
