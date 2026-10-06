// Pure: a request's text as a numbered outline — the model the request
// window's editor edits and every other reader (points, reviews, the prompt)
// reads. Stored as plain text in the description body (no migration):
//
//   Water card should be red          ← point 1
//                                      ← a blank line separates points
//     Also in dark mode               ← point 1.1: a sub-point starts with two spaces
//
//   Transit times are wrong           ← point 2
//   still UTC after midnight          ← one Enter inside a point is a line break
//
// One level of nesting (points and sub-points). A sub-point before any main
// point reads as a main point. A point collected into a re-check request
// keeps the owner's "Still not fixed: …" line after its words; it is the
// point's `tail` (shown as a callout, never edited as text). Older text keeps
// reading the same: every paragraph is a point and an old "3- text" line
// starts one (its "3- " dropped, as before).
// Import-free apart from checkpoints.ts so the verify script can require it.

import { LEGACY_POINT_RE } from './checkpoints'

export type PointLevel = 0 | 1

export interface OutlinePoint {
  level: PointLevel
  /** The owner's words: may hold single line breaks and `[[@id]]` links. */
  text: string
  /** "Still not fixed: …" (a re-check request's point); null otherwise. */
  tail: string | null
}

/** The line a collected point carries under the original's words. */
export const STILL_RE = /^Still not fixed\b/

const SEPARATOR_RE = /\n[ \t]*\n/
const INDENT_RE = /^(?: {2,}|\t)/
const INDENT = '  '

/**
 * A point's words as stored: no blank lines inside (a blank line separates
 * points), nothing before the first word, no line breaks at the end.
 */
export function normalizePointText(text: string): string {
  let t = text.replace(/\r\n?/g, '\n')
  for (;;) { const n = t.replace(/\n[ \t]*\n/g, '\n'); if (n === t) break; t = n }
  return t.replace(/^\s+/, '').replace(/\s*\n\s*$/, '')
}

/**
 * The outline of a body. `keepEmpty` keeps empty points (the editor's rows
 * being typed); without it, only points with words are returned.
 */
export function parseOutline(body: string, opts: { keepEmpty?: boolean } = {}): OutlinePoint[] {
  const out: OutlinePoint[] = []
  for (const raw of body.replace(/\r\n?/g, '\n').split(SEPARATOR_RE)) {
    const block = raw.replace(/^(?:[ \t]*\n)+/, '')
    let level: PointLevel = INDENT_RE.test(block) ? 1 : 0
    let lines: string[] = []
    const flush = () => {
      const cut = lines.findIndex((l, i) => i > 0 && STILL_RE.test(l.trim()))
      const words = cut > 0 ? lines.slice(0, cut) : lines
      const tail = cut > 0 ? lines.slice(cut).map(l => l.trim()).filter(Boolean).join('\n') : null
      const text = normalizePointText(words.join('\n'))
      if (text || tail || opts.keepEmpty) out.push({ level, text, tail: tail || null })
      lines = []
    }
    let started = false
    for (const line of block.split('\n')) {
      const m = LEGACY_POINT_RE.exec(line)
      if (m && m[3].trim()) {
        if (started) flush()
        level = 0
        lines.push(m[3].trim())
        started = true
        continue
      }
      lines.push(line)
      started = true
    }
    if (started || opts.keepEmpty) flush()
  }
  // A paragraph of nothing but blank lines adds no point unless asked.
  const points = opts.keepEmpty ? out : out.filter(p => p.text || p.tail)
  if (points.length) points[0] = { ...points[0], level: 0 }
  return points
}

/** The body for an outline (the inverse of parseOutline with keepEmpty). */
export function serializeOutline(points: readonly Pick<OutlinePoint, 'level' | 'text' | 'tail'>[]): string {
  return points.map((p, i) => {
    const text = normalizePointText(p.text)
    const full = p.tail ? (text ? `${text}\n${p.tail}` : p.tail) : text
    return (p.level === 1 && i > 0 ? INDENT : '') + full
  }).join('\n\n')
}

/** The text a point is known by (its key, the prompt): words and tail. */
export const pointFullText = (p: Pick<OutlinePoint, 'text' | 'tail'>): string =>
  (p.tail ? `${p.text.trim()}\n${p.tail}` : p.text).trim()

export const isEmptyPoint = (p: Pick<OutlinePoint, 'text' | 'tail'>): boolean => !p.text.trim() && !p.tail

/**
 * The number each point shows: 1, 2 … for points, 1.1, 1.2 … for the
 * sub-points under point 1. A sub-point with no point above it numbers as a
 * point.
 */
export function outlineLabels(points: readonly Pick<OutlinePoint, 'level'>[]): string[] {
  let main = 0
  let sub = 0
  return points.map((p, i) => {
    if (p.level === 1 && i > 0 && main > 0) { sub++; return `${main}.${sub}` }
    main++
    sub = 0
    return `${main}`
  })
}

/** The "Still not fixed" note of a tail ('' when it has none). */
export const tailNote = (tail: string | null): string =>
  (tail ?? '').split('\n').map(l => l.trim().replace(/^Still not fixed[:.]?\s*/, '')).filter(Boolean).join(' ')

// ── Editing (pure; the editor applies the result) ─────────────────────────────

export interface Caret { index: number; offset: number }
type P = OutlinePoint

const clampOffset = (p: P | undefined, offset: number) => Math.max(0, Math.min(offset, p?.text.length ?? 0))

/**
 * Enter: the text after the caret becomes the next point, at the same
 * level. Enter on an empty sub-point makes it a point instead (lists work
 * like that everywhere). `[start, end]` is the selection, replaced first.
 */
export function splitPoint<T extends P>(points: readonly T[], index: number, start: number, end = start, make: (p: P) => T = p => p as T): { points: T[]; caret: Caret } {
  const p = points[index]
  if (!p) return { points: [...points], caret: { index: 0, offset: 0 } }
  const a = clampOffset(p, Math.min(start, end))
  const b = clampOffset(p, Math.max(start, end))
  if (p.level === 1 && !p.text.trim() && !p.tail) {
    return { points: points.map((x, i) => (i === index ? { ...x, level: 0 as const, text: '' } : x)), caret: { index, offset: 0 } }
  }
  // At the very start: a new empty point above, the words (and their tail) stay together.
  if (b === 0 && p.text.trim()) {
    const next = [...points]
    next.splice(index, 0, make({ level: p.level, text: '', tail: null }))
    return { points: next, caret: { index: index + 1, offset: 0 } }
  }
  const before = p.text.slice(0, a).replace(/\n+$/, '')
  const after = p.text.slice(b).replace(/^\n+/, '')
  // The tail belongs to the words it was collected with: it stays on the first half.
  const next = [...points]
  next.splice(index, 1, { ...p, text: before }, make({ level: p.level, text: after, tail: null }))
  return { points: next, caret: { index: index + 1, offset: 0 } }
}

/**
 * Backspace at the start of a point: a sub-point becomes a point first;
 * a point joins the one above (an empty one simply goes).
 */
export function joinWithPrevious<T extends P>(points: readonly T[], index: number): { points: T[]; caret: Caret } | null {
  const p = points[index]
  if (!p || index === 0) return null
  if (p.level === 1) return { points: points.map((x, i) => (i === index ? { ...x, level: 0 as const } : x)), caret: { index, offset: 0 } }
  const prev = points[index - 1]
  if (p.tail && prev.tail) return null // two collected points never merge their notes
  const glue = prev.text && p.text && !/\s$/.test(prev.text) && !/^\s/.test(p.text) ? ' ' : ''
  const merged = { ...prev, text: prev.text + glue + p.text, tail: prev.tail ?? p.tail }
  const next = [...points]
  next.splice(index - 1, 2, merged)
  return { points: next, caret: { index: index - 1, offset: prev.text.length + glue.length } }
}

/** Delete at the end of a point: the next one joins it. */
export function joinWithNext<T extends P>(points: readonly T[], index: number): { points: T[]; caret: Caret } | null {
  if (index >= points.length - 1) return null
  const r = joinWithPrevious(points.map((x, i) => (i === index + 1 ? { ...x, level: 0 as const } : x)), index + 1)
  return r
}

/** Tab / Shift+Tab: a sub-point or back to a point (the first point stays a point). */
export function setLevel<T extends P>(points: readonly T[], index: number, level: PointLevel): T[] {
  if (!points[index] || (index === 0 && level === 1)) return [...points]
  return points.map((x, i) => (i === index ? { ...x, level } : x))
}

/**
 * Pasted text: separate blocks (a blank line between them) become points of
 * their own — the first joins the text before the caret, the last the text
 * after it; single line breaks stay line breaks. A pasted block indented by
 * two spaces is a sub-point.
 */
export function pasteText<T extends P>(points: readonly T[], index: number, start: number, end: number, raw: string, make: (p: P) => T = p => p as T): { points: T[]; caret: Caret } {
  const p = points[index]
  if (!p) return { points: [...points], caret: { index: 0, offset: 0 } }
  const a = clampOffset(p, Math.min(start, end))
  const b = clampOffset(p, Math.max(start, end))
  const text = raw.replace(/\r\n?/g, '\n')
  const blocks = text.split(SEPARATOR_RE).map(x => x.replace(/^(?:[ \t]*\n)+/, '')).filter(x => x.trim())
  const before = p.text.slice(0, a)
  const after = p.text.slice(b)
  if (blocks.length <= 1) {
    const one = (blocks[0] ?? '').replace(/^\n+|\n+$/g, '')
    const inserted = /^\s/.test(text) || !blocks.length ? one : one.replace(/^[ \t]+/, '')
    return {
      points: points.map((x, i) => (i === index ? { ...x, text: before + inserted + after } : x)),
      caret: { index, offset: before.length + inserted.length },
    }
  }
  const strip = (s: string) => s.replace(/^[ \t]+/, '').replace(/\n+$/, '')
  const first = { ...p, text: before + strip(blocks[0]) }
  const middle = blocks.slice(1, -1).map(bl => make({ level: INDENT_RE.test(bl) ? 1 : p.level, text: strip(bl), tail: null }))
  const lastBlock = blocks[blocks.length - 1]
  const lastText = strip(lastBlock)
  const last = make({ level: INDENT_RE.test(lastBlock) ? 1 : p.level, text: lastText + after, tail: null })
  const next = [...points]
  next.splice(index, 1, first, ...middle, last)
  return { points: next, caret: { index: index + blocks.length - 1, offset: lastText.length } }
}

/**
 * Puts `token` (a link) into point `at.index` at `at.offset`, with a space on
 * either side where needed. Null `at`: the end of the last point.
 */
export function insertIntoOutline(points: readonly P[], token: string, at: Caret | null): { points: P[]; caret: Caret } {
  const list: P[] = points.length ? [...points] : [{ level: 0, text: '', tail: null }]
  const index = at ? Math.max(0, Math.min(at.index, list.length - 1)) : list.length - 1
  const p = list[index]
  const offset = at && at.index === index ? clampOffset(p, at.offset) : p.text.length
  const before = p.text.slice(0, offset)
  const after = p.text.slice(offset)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = /^\s/.test(after) ? '' : ' '
  list[index] = { ...p, text: `${before}${lead}${token}${trail}${after}` }
  return { points: list, caret: { index, offset: before.length + lead.length + token.length + trail.length } }
}
