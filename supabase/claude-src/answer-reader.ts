// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · reading an answer
//
//  What every job needs to take the model's text apart: find the JSON object in
//  it, and check each value in it. The checks are strict on purpose: a value of
//  the wrong type, outside its range or too long is DROPPED (a number is never
//  nudged into range, a long text is never cut short), because a guessed or
//  repaired value looks like a real one on the owner's screen. Whole lists are
//  the one exception: a list longer than its limit keeps its first entries.
//
//  Also here: the escaping that lets an input travel as data inside its tag.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The JSON object in an answer: the text itself; or inside a markdown code fence; or, after a note of working-out
 * ("Today is Sunday, so the next Tuesday is …", seen live 22.11.2026), the object that starts on a line of its own
 * and runs to the end. The note is dropped; the object is then checked like any answer. Anything else stays as it
 * is and fails to parse.
 */
export function answerJsonText(answerText: string): string {
  const text = answerText.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text)
  if (fenced) return fenced[1]
  if (text.startsWith('{') || !text.endsWith('}')) return text
  const start = text.search(/\n\{/)
  return start >= 0 ? text.slice(start + 1) : text
}

/** A plain object: not null, not a list. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The answer as one JSON object, or why it is not. Nothing in it is checked yet. */
export function readAnswerObject(answerText: string): { ok: true; value: Record<string, unknown> } | { ok: false; problem: string } {
  let raw: unknown
  try {
    raw = JSON.parse(answerJsonText(answerText))
  } catch {
    return { ok: false, problem: 'it was not JSON' }
  }
  if (!isPlainObject(raw)) return { ok: false, problem: 'it was not a JSON object' }
  return { ok: true, value: raw }
}

/** An object's own value only: "constructor" or "__proto__" in an answer never reads Object's. */
export function answerValue(from: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(from, key) ? from[key] : undefined
}

// Control characters other than the tab and the line break.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
const ANSWER_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g

/**
 * A one-line text: a string whose white space (line breaks included) is collapsed to single spaces, at least one
 * character and at most `max`. Anything else (not a string, empty, too long) is null.
 */
export function checkedLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(ANSWER_CONTROL, '').replace(/\s+/g, ' ').trim()
  return text.length >= 1 && [...text].length <= max ? text : null
}

/** A number (a real number, never text that looks like one) from `min` to `max`; anything else is null. */
export function checkedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null
}

/** The first `max` entries of a list; anything that is not a list is an empty one. */
export function checkedList(value: unknown, max: number): unknown[] {
  return Array.isArray(value) ? value.slice(0, max) : []
}

/** A text with & < > written out, so nothing in it can close its tag or open another. */
export function escapeTagText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
