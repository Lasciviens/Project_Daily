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

// How far the scan for an object goes: it starts again after a stray "{" (in a note) at most this many times, and it
// tries the last this-many objects it finds, so a hostile text costs a few passes over itself, never more.
const SCAN_RESTARTS = 8
const SCAN_TRIES = 8

/** Where the object that opens at `start` closes (string-aware: a brace inside a "text" does not count), or -1. */
function objectEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (inString) {
      if (c === 92) i++ // a backslash: the next character is part of the string
      else if (c === 34) inString = false
    } else if (c === 34) inString = true
    else if (c === 123) depth++
    else if (c === 125 && --depth === 0) return i
  }
  return -1
}

/**
 * The last top-level `{…}` in the text that parses as a JSON object: for an answer that is JSON followed by a note,
 * a note and the object on one line, or a note followed by a code fence. Linear: one pass finds the top-level objects
 * (restarting after a stray "{" a few times), and only the last few are parsed. A list (or anything starting with
 * "[") is never searched: an array answer stays refused.
 */
function lastObjectIn(text: string): Record<string, unknown> | null {
  if (text.trimStart().startsWith('[')) return null
  const found: [number, number][] = []
  let from = 0
  let restarts = 0
  while (from < text.length) {
    const start = text.indexOf('{', from)
    if (start < 0) break
    const end = objectEnd(text, start)
    if (end < 0) {
      if (++restarts > SCAN_RESTARTS) break
      from = start + 1
    } else {
      found.push([start, end])
      from = end + 1
    }
  }
  for (const [start, end] of found.slice(-SCAN_TRIES).reverse()) {
    try {
      const value: unknown = JSON.parse(text.slice(start, end + 1))
      if (isPlainObject(value)) return value
    } catch { /* not JSON: the one before it */ }
  }
  return null
}

/** The answer as one JSON object, or why it is not. Nothing in it is checked yet. */
export function readAnswerObject(answerText: string): { ok: true; value: Record<string, unknown> } | { ok: false; problem: string } {
  let raw: unknown
  try {
    raw = JSON.parse(answerJsonText(answerText))
  } catch {
    const found = lastObjectIn(answerText)
    if (!found) return { ok: false, problem: 'it was not JSON' }
    return { ok: true, value: found }
  }
  if (!isPlainObject(raw)) return { ok: false, problem: 'it was not a JSON object' }
  return { ok: true, value: raw }
}

/** An object's own value only: "constructor" or "__proto__" in an answer never reads Object's. */
export function answerValue(from: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(from, key) ? from[key] : undefined
}

// Control characters other than the tab and the line break, and the zero-width and text-direction characters (U+200B–200F,
// U+202A–202E, U+2066–2069, U+FEFF): they draw nothing and can hide a word from a check (a link split by one) or reorder
// what the owner reads.
// eslint-disable-next-line no-control-regex -- control characters are exactly what is taken out
const ANSWER_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

/**
 * A one-line text: a string whose white space (line breaks included) is collapsed to single spaces, at least one
 * character and at most `max`. Anything else (not a string, empty, too long) is null.
 */
export function checkedLine(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(ANSWER_CONTROL, '').replace(/\s+/g, ' ').trim()
  return text.length >= 1 && [...text].length <= max ? text : null
}

/**
 * A model's free-text answer: control characters out, each line's ends trimmed, three or more line breaks in a row
 * made two. With `bold: false` the markdown marks a small screen cannot show (**, a leading #) are taken out too;
 * with `bold: true` the **bold** marks stay (the PT screen draws them). Null when nothing is left, or when it is
 * longer than `max` characters: a long answer is thrown away, never cut short.
 */
export function checkedAnswerText(value: unknown, max: number, bold: boolean): string | null {
  if (typeof value !== 'string') return null
  let text = value.replace(ANSWER_CONTROL, '').replace(/\r\n?/g, '\n')
  if (!bold) text = text.replace(/\*\*/g, '').replace(/^[ \t]*#+[ \t]*/gm, '')
  text = text.split('\n').map(line => line.trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
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
