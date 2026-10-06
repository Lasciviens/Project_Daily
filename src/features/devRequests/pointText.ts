// Pure: a request's text as points. Every paragraph is a point — a single
// Enter is a line break inside it, an empty line starts the next one. Older
// requests also wrote "1- text" lines; each of those starts a point too.
// A point is known by a key hashed from its own text, so a review stored for
// it (devRequestMarks' `[[review …]]`) stays with it while other points are
// edited, added or removed; editing the point itself gives it a new key.
// Import-free apart from checkpoints.ts so the verify script can require it.

import { LEGACY_POINT_RE } from './checkpoints'

/** The text of each point, in order (trimmed; empty paragraphs dropped). */
export function splitPoints(body: string): string[] {
  const out: string[] = []
  for (const para of body.split(/\n[ \t]*\n/)) {
    let current: string[] = []
    const flush = () => { const t = current.join('\n').trim(); if (t) out.push(t); current = [] }
    for (const line of para.split('\n')) {
      const m = LEGACY_POINT_RE.exec(line)
      if (m && m[3].trim()) { flush(); current.push(m[3].trim()); continue }
      current.push(line)
    }
    flush()
  }
  return out
}

/** What a key is computed from: case, spacing and an old "3- " prefix don't count. */
export const normalizePoint = (text: string): string =>
  text.replace(LEGACY_POINT_RE, '$3').replace(/\s+/g, ' ').trim().toLowerCase()

/** 32-bit FNV-1a, base 36 — short and stable, not a security hash. */
export function hashText(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36)
}

/** One key per point; a second point with the same text gets `~1`, a third `~2`. */
export function pointKeys(texts: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return texts.map(t => {
    const base = hashText(normalizePoint(t))
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n ? `${base}~${n}` : base
  })
}
