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

const TASK: Record<AskKind, string> = {
  explain: 'Explain what the selected passage means in plain words: what happens, what is implied, any idiom or reference.',
  translate: 'Translate the selected passage. Keep the tone. Add one short line on any phrase that does not translate literally.',
  word: 'Explain the selected word or phrase as used here: meaning in this context, base form, and one short example.',
  character: 'Say who or what the selected name is, using only what the book has shown so far.',
  free: 'Answer the reader’s question about the selected passage.',
}

/** The system instruction and the user turn for Gemini. Stable wording keeps answers consistent. */
export function buildAskPrompt(a: AskInput): { system: string; user: string } {
  const where = a.percent !== null ? `The reader is ${Math.round(a.percent)}% through the book.` : ''
  const system = [
    'You help someone reading a book on an e-reader. Answers appear on a small e-ink screen.',
    `Answer in ${a.answer_language}. Be brief: at most 120 words, plain text, no markdown, no lists unless needed.`,
    'Never reveal anything that happens later in the book than where the reader is. If you are not sure whether something is a spoiler, leave it out.',
    'If the passage alone is not enough to answer, say so in one sentence.',
  ].join(' ')
  const book = [a.title && `Book: ${a.title}`, a.author && `Author: ${a.author}`, a.language && `Book language: ${a.language}`, where].filter(Boolean).join('\n')
  const user = [
    book,
    `Task: ${TASK[a.ask]}`,
    a.question ? `Reader’s question: ${a.question}` : '',
    `Text before: …${a.before}`,
    `Selected: «${a.selection}»`,
    `Text after: ${a.after}…`,
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

/** Gemini's text, trimmed to what an e-ink box shows well. */
export function cleanAnswer(text: unknown): string | null {
  if (typeof text !== 'string') return null
  const t = text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim()
  return t ? t.slice(0, 2500) : null
}

// ── Device facts sent with a sync ───────────────────────────────────────────

export function cleanDeviceFacts(raw: Record<string, unknown>): { battery?: number; charging?: boolean; koreader_version?: string } {
  const out: { battery?: number; charging?: boolean; koreader_version?: string } = {}
  if (typeof raw.battery === 'number' && Number.isFinite(raw.battery) && raw.battery >= 0 && raw.battery <= 100) out.battery = Math.round(raw.battery)
  if (typeof raw.charging === 'boolean') out.charging = raw.charging
  if (typeof raw.koreader_version === 'string' && raw.koreader_version.trim()) out.koreader_version = raw.koreader_version.trim().slice(0, 40)
  return out
}
