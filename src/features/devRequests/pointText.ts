// Pure: a request's points and the keys they are known by. The points come
// from the outline (outline.ts: a blank line separates points, two spaces
// mark a sub-point, older "1- text" lines start one too). A point is known by
// a key hashed from its own text — not its number or its indent — so a
// review stored for it (devRequestMarks' `[[review …]]`) stays with it while
// other points are edited, added, moved or indented; editing the point itself
// gives it a new key.
// Import-free apart from other pure modules so the verify script can require it.

import { LEGACY_POINT_RE } from './checkpoints'
import { parseOutline, pointFullText } from './outline'

/** The text of each point, in order (words + any "Still not fixed" tail; empty ones dropped). */
export function splitPoints(body: string): string[] {
  return parseOutline(body).map(pointFullText)
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
