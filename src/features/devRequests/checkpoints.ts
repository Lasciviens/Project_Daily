// Pure: older checkpoints in a request's description — "- [ ] text" /
// "- [x] text" lines from before points were automatic. They still read: each
// is a point (points.ts) and a ticked one counts as Fixed; the composer shows
// them as paragraphs of the text, and the first edit or review folds them in
// (devRequestMarks.foldCheckpoints). Nothing writes new ones.
// Import-free so scripts/verify-dev-request-context.cjs can require it.

export interface Checkpoint {
  done: boolean
  text: string
}

/** `- [ ] text`, `- [x] text` (also `*` and `X`); the text may be empty while it is typed. */
export const CHECKPOINT_RE = /^[ \t]*[-*] \[( |x|X)\](?: (.*))?$/

/** Numbered points from before checkpoints ("3- text"), still in older requests. */
export const LEGACY_POINT_RE = /^([ \t]*)(\d{1,3})- (.*)$/

export function parseCheckpointLine(line: string): Checkpoint | null {
  const m = CHECKPOINT_RE.exec(line)
  return m ? { done: m[1] !== ' ', text: (m[2] ?? '').trim() } : null
}

export const checkpointLine = (c: Checkpoint) => `- [${c.done ? 'x' : ' '}] ${c.text.replace(/\s*\n\s*/g, ' ')}`.trimEnd()

/** "2/5 checkpoints done"; '' when there are none (empty ones don't count). */
export function checkpointProgress(items: readonly Checkpoint[]): string {
  const real = items.filter(c => c.text.trim())
  if (real.length === 0) return ''
  const done = real.filter(c => c.done).length
  return `${done}/${real.length} checkpoint${real.length === 1 ? '' : 's'} done`
}

// ── List edits (return a new list) ────────────────────────────────────────────

export const setDone = (items: readonly Checkpoint[], index: number, done: boolean): Checkpoint[] =>
  items.map((c, i) => (i === index ? { ...c, done } : c))

export const setText = (items: readonly Checkpoint[], index: number, text: string): Checkpoint[] =>
  items.map((c, i) => (i === index ? { ...c, text } : c))

export const removeAt = (items: readonly Checkpoint[], index: number): Checkpoint[] =>
  items.filter((_, i) => i !== index)

/** A new empty checkpoint after `index` (-1 or past the end: at the end). */
export function insertAfter(items: readonly Checkpoint[], index: number): { items: Checkpoint[]; at: number } {
  const at = index < 0 || index >= items.length ? items.length : index + 1
  const next = [...items]
  next.splice(at, 0, { done: false, text: '' })
  return { items: next, at }
}

/**
 * The index of the `nth` checkpoint (0-based) whose text is `text`: a tick
 * made in the composer finds the same checkpoint in the saved row, whose
 * list may differ from the draft's (points added or removed in the draft).
 */
export function findCheckpoint(items: readonly Checkpoint[], text: string, nth = 0): number {
  let seen = 0
  for (let i = 0; i < items.length; i++) {
    if (items[i].text.trim() !== text.trim()) continue
    if (seen === nth) return i
    seen++
  }
  return -1
}

/** Which occurrence of its own text checkpoint `index` is (0 for the first). */
export function occurrenceOf(items: readonly Checkpoint[], index: number): number {
  const text = items[index]?.text.trim()
  let n = 0
  for (let i = 0; i < index; i++) if (items[i].text.trim() === text) n++
  return n
}
