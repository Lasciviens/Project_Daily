// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: text, trust and quarantine rules (pure)
//
//  Everything the app learns is TEXT that came from somewhere: the owner's save, a model's answer, a receipt, a page, the
//  repo's docs. Before any text becomes a case, a lesson or a key it goes through these rules:
//    · hidden Unicode out (zero-width, text-direction, tag characters, other invisibles), again and again until the text
//      no longer changes (one pass can uncover another: a normalisation that makes a new invisible);
//    · plain text only for anything a model may later read as a note (no markup, brackets, links, control characters);
//    · a lesson's trust is the lowest of its sources, and only a FACT from a TRUSTED source that does not read like an
//      instruction turns on by itself; everything instruction-like waits for the owner (the database says it again);
//    · a case's split (train / test / sealed) is a stable hash of its id, never chosen by anyone.
//  No imports: the verify scripts run this file as it is.
// ─────────────────────────────────────────────────────────────────────────────

// Every format character (\p{Cf}: zero-width and joiners, text direction, word joiners, invisible operators, the BOM, the
// soft hyphen, the tag block U+E0000–E007F of invisible ASCII lookalikes, …), lone surrogates, private-use characters, and
// the invisible ones Unicode does not call format: variation selectors, the Hangul fillers, the Khmer inherent vowels, the
// Mongolian free variation selectors. The same pattern as build-docs-snapshot.mjs's DOCS_HIDDEN (verify-ai-learning-docs).
// eslint-disable-next-line no-misleading-character-class -- variation selectors and the like are exactly what is taken out
const LEARN_HIDDEN = /\p{Cf}|\p{Cs}|\p{Co}|[\u{115F}\u{1160}\u{17B4}\u{17B5}\u{180B}-\u{180F}\u{3164}\u{FE00}-\u{FE0F}\u{FFA0}\u{E0100}-\u{E01EF}]/gu
// Control characters, line breaks and tabs among them: learned text is one line, the caller collapses spaces.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
const LEARN_CONTROL = /[\p{Cc}]/gu

/** The text with every hidden character and control character removed, normalised (NFKC), repeated until stable. */
export function stripHidden(text: string): string {
  let now = typeof text === 'string' ? text : ''
  for (let i = 0; i < 10; i++) {
    const next = now.normalize('NFKC').replace(LEARN_HIDDEN, '').replace(LEARN_CONTROL, ' ')
    if (next === now) return next
    now = next
  }
  // Ten passes and still moving: something is built to fight the cleaner. Nothing of it is kept.
  return ''
}

/** True when the text still holds a hidden or control character (a last-line guard after `stripHidden`). */
export function holdsHidden(text: string): boolean {
  LEARN_HIDDEN.lastIndex = 0
  LEARN_CONTROL.lastIndex = 0
  const found = LEARN_HIDDEN.test(text) || LEARN_CONTROL.test(text)
  LEARN_HIDDEN.lastIndex = 0
  LEARN_CONTROL.lastIndex = 0
  return found
}

// What a plain note may not hold (the same as the database's ai_suggestion_plain, 199): brackets of any kind that read as
// markup or marks, a backtick, a link of any form (a scheme, www, // or any name.tld).
const LEARN_NOT_PLAIN = /[[\]<>`]|https?:|www\.|\/\/|\b[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}\b/i

/** One plain line: hidden characters out, spaces collapsed, within the length, no markup or link. Null when it is not one. */
export function plainLine(value: unknown, max: number, min = 1): string | null {
  if (typeof value !== 'string') return null
  const text = stripHidden(value).replace(/\s+/g, ' ').trim()
  if ([...text].length < min || [...text].length > max) return null
  return LEARN_NOT_PLAIN.test(text) || holdsHidden(text) ? null : text
}

/** A value as the learning layer stores it: a short single line (no plain-text rule: a saved name may hold a dot). */
export function storedValue(value: unknown, max = 2000): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    const parts = value.map(v => storedValue(v, 200)).filter((v): v is string => v !== null)
    return parts.length ? cutText(parts.join(', '), max) : null
  }
  if (typeof value !== 'string') return null
  const text = stripHidden(value).replace(/\s+/g, ' ').trim()
  return text ? cutText(text, max) : null
}

function cutText(text: string, max: number): string {
  const chars = [...text]
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

/** The key two texts share when they mean the same thing: hidden characters, accents, case and punctuation gone. */
export function normKey(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const key = stripHidden(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  return key ? cutText(key, 200) : null
}

// Words that make a note read as an instruction to the model rather than a fact about the owner. A lesson that holds one
// is instruction-like and ALWAYS waits for the owner's tap, whatever its source (published memory-poisoning attacks
// steer agents with exactly such notes).
const LEARN_INSTRUCTION_WORDS = /\b(always|never|must|should|shall|ignore|disregard|forget|instead|override|pretend|act as|you|your|assistant|model|claude|ai|system|prompt|instructions?|rules?|tools?|confirm|approve|permission|allowed?|execute|run|call|send|delete|remove|password|keys?|tokens?|secrets?|reply|respond|answer|do not|don't)\b/i

/** Whether a note reads as an instruction (a word from the list, or an imperative "Use … / Put … / Set …" start). */
export function isInstructionLike(text: string): boolean {
  const t = stripHidden(text)
  return LEARN_INSTRUCTION_WORDS.test(t) || /^\s*(use|put|set|choose|pick|treat|give|make|add|write|tell|show|skip|prefer|avoid|only)\b/i.test(t)
}

export type LessonKind = 'fact' | 'preference' | 'instruction'
export type LessonSource = 'owner_typed' | 'owner_data' | 'weekly_batch' | 'chat_tool' | 'repo_doc' | 'web'
export type Trust = 'high' | 'medium' | 'low'
export const LESSON_KINDS: readonly LessonKind[] = ['fact', 'preference', 'instruction']
export const LESSON_SOURCES: readonly LessonSource[] = ['owner_typed', 'owner_data', 'weekly_batch', 'chat_tool', 'repo_doc', 'web']

/** How far a source is trusted: the owner's own typed words or data, then text a model derived from them, then outside text. */
export const SOURCE_TRUST: Readonly<Record<LessonSource, Trust>> = {
  owner_typed: 'high', owner_data: 'high', weekly_batch: 'medium', chat_tool: 'medium', repo_doc: 'medium', web: 'low',
}

const TRUST_ORDER: readonly Trust[] = ['low', 'medium', 'high']
/** A lesson's trust is the lowest of its sources. */
export function lowestTrust(trusts: readonly Trust[]): Trust {
  return trusts.reduce<Trust>((low, t) => (TRUST_ORDER.indexOf(t) < TRUST_ORDER.indexOf(low) ? t : low), 'high')
}

/** How long a lesson lives before it retires by itself, by kind (a preference is checked again sooner than a fact). */
export const LESSON_DAYS: Readonly<Record<LessonKind, number>> = { fact: 365, preference: 180, instruction: 180 }

/**
 * Where a new lesson starts. `verifiedInOwnerWords`: code found the lesson's words in what the owner typed in this very
 * turn (never in a tool result or a page), so a chat tool's fact counts as the owner's own. Only a fact from a trusted
 * source that does not read as an instruction is active at once; everything else is pending until the owner's tap.
 */
export function lessonStart(kind: LessonKind, source: LessonSource, text: string, verifiedInOwnerWords = false): { state: 'active' | 'pending'; trust: Trust } {
  // A chat tool's note in the owner's own typed words counts as the owner's own; any other note keeps its source's trust.
  const trust: Trust = lowestTrust([verifiedInOwnerWords && (source === 'chat_tool' || source === 'owner_typed') ? 'high' : SOURCE_TRUST[source]])
  const active = kind === 'fact' && trust === 'high' && !isInstructionLike(text)
  return { state: active ? 'active' : 'pending', trust }
}

/** The longest message that still reads as typed by the owner (guardian B1): a pasted page is longer, or has more lines. */
export const TYPED_LIMITS = { chars: 300, lines: 2 } as const

/**
 * Whether a note is the owner's own words (guardian B1): the message reads as typed (at most 300 characters and 2 lines),
 * and the cleaned note's WHOLE word list, every word however short, is one unbroken run of words in the cleaned message.
 * So "95 kg" is not "80 kg", "no meat" is not "meat", and a fact lifted out of a pasted page never counts as the owner's.
 */
export function factInOwnersWords(note: string, ownerText: string): boolean {
  if (typeof ownerText !== 'string' || [...ownerText].length > TYPED_LIMITS.chars || ownerText.split(/\r\n|\r|\n/).length > TYPED_LIMITS.lines) return false
  const words = (normKey(note) ?? '').split(' ').filter(Boolean)
  const own = (normKey(ownerText) ?? '').split(' ').filter(Boolean)
  if (!words.length || words.length > own.length) return false
  for (let i = 0; i + words.length <= own.length; i++) {
    if (words.every((w, j) => own[i + j] === w)) return true
  }
  return false
}

/** FNV-1a, 32 bits: a stable number from a text (the same in every runtime). */
export function stableHash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

export type Split = 'train' | 'test' | 'sealed'
/** A case's split from its id: 6 in 10 train (the example pool and lesson source), 3 test (the score), 1 sealed (never tuned on). */
export function splitOf(id: string): Split {
  const n = stableHash(`split:${id}`) % 10
  return n < 6 ? 'train' : n < 9 ? 'test' : 'sealed'
}

/** Text for a tag: & < > escaped, one line per item (never markup the model could read as structure). */
export function learnEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
