// Pure: numbered sub-items ("1- ", "2- " …) in a request's description.
// The composer's "Numbered list" button starts one, Enter on an item line
// continues it, Enter on an empty item ends it. The prompt builder turns the
// lines into separate numbered points (devRequestPrompt.ts).
// Import-free so scripts/verify-dev-request-context.cjs can require it.

/** `  3- text` → indent, number, text. */
export const NUMBERED_ITEM_RE = /^([ \t]*)(\d{1,3})- (.*)$/

export interface TextEdit {
  text: string
  /** Where the caret goes (selection collapsed). */
  caret: number
}

const lineStartAt = (text: string, pos: number) => text.lastIndexOf('\n', pos - 1) + 1
const lineEndAt = (text: string, pos: number) => {
  const i = text.indexOf('\n', pos)
  return i === -1 ? text.length : i
}

/** The number the item before line `start` would lead to (1 when there is none). */
function nextNumberAfterPrevious(text: string, start: number): { n: number; indent: string } {
  if (start === 0) return { n: 1, indent: '' }
  const prevStart = lineStartAt(text, start - 1)
  const m = NUMBERED_ITEM_RE.exec(text.slice(prevStart, start - 1))
  return m ? { n: Number(m[2]) + 1, indent: m[1] } : { n: 1, indent: '' }
}

/**
 * Renumbers the numbered lines that directly follow `from` (same indent), so
 * a continued item in the middle of a list does not leave two "3- " lines.
 */
function renumberAfter(text: string, from: number, next: number, indent: string): string {
  let pos = lineEndAt(text, from)
  let out = text
  let n = next
  while (pos < out.length) {
    const start = pos + 1
    const end = lineEndAt(out, start)
    const m = NUMBERED_ITEM_RE.exec(out.slice(start, end))
    if (!m || m[1] !== indent) break
    const line = `${indent}${n}- ${m[3]}`
    out = out.slice(0, start) + line + out.slice(end)
    pos = start + line.length
    n++
  }
  return out
}

/**
 * The "Numbered list" button: an empty line becomes "1- " (or the next
 * number after an item above it); a line of text gets the number in front;
 * on an item line a new item starts below it.
 */
export function insertNumberedItem(text: string, caret: number): TextEdit {
  const pos = Math.max(0, Math.min(caret, text.length))
  const start = lineStartAt(text, pos)
  const end = lineEndAt(text, pos)
  const line = text.slice(start, end)
  const item = NUMBERED_ITEM_RE.exec(line)
  if (item) {
    const n = Number(item[2]) + 1
    const add = `\n${item[1]}${n}- `
    const out = renumberAfter(text.slice(0, end) + add + text.slice(end), end + 1, n + 1, item[1])
    return { text: out, caret: end + add.length }
  }
  const { n, indent } = nextNumberAfterPrevious(text, start)
  const marker = `${indent}${n}- `
  const body = line.replace(/^[ \t]+/, '')
  const out = text.slice(0, start) + marker + body + text.slice(end)
  return { text: out, caret: start + marker.length + body.length }
}

/**
 * Enter pressed with the caret at `caret` (no selection). On an item line:
 * a new item with the next number (text after the caret moves into it); on
 * an empty item ("3- " and nothing else): the marker is removed, which ends
 * the list. null when the line is not an item — let Enter do its usual thing.
 */
export function continueNumberedList(text: string, caret: number): TextEdit | null {
  const start = lineStartAt(text, caret)
  const end = lineEndAt(text, caret)
  const m = NUMBERED_ITEM_RE.exec(text.slice(start, end))
  if (!m) return null
  const markerEnd = start + m[1].length + m[2].length + 2
  if (caret < markerEnd) return null
  if (!m[3].trim()) {
    const out = text.slice(0, start) + text.slice(end)
    return { text: out, caret: start }
  }
  const n = Number(m[2]) + 1
  const add = `\n${m[1]}${n}- `
  const inserted = text.slice(0, caret) + add + text.slice(caret)
  const newLineStart = caret + 1
  return { text: renumberAfter(inserted, newLineStart, n + 1, m[1]), caret: caret + add.length }
}
