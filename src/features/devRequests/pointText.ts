// Pure: a request's points and the keys they are known by. The points come
// from the outline (outline.ts: a blank line separates points, two spaces
// mark a sub-point, older "1- text" lines start one too). A point is known by
// a key hashed from its own words — not its number, its indent or a re-check
// request's "Still not fixed: …" note under them — so a review stored for it
// (devRequestMarks' `[[review …]]`) stays with it while other points are
// edited, added, moved or indented and while its note is edited; editing the
// point's words gives it a new key.
// Import-free apart from other pure modules so the verify script can require it.

import { LEGACY_POINT_RE } from './checkpoints'
import { parseOutline, pointFullText, type OutlinePoint } from './outline'

/** What each point is known by, in order: its words (never its "Still not fixed" tail; empty points dropped). */
export function splitPoints(body: string): string[] {
  return parseOutline(body).map(p => p.text)
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

/**
 * Reviews stored before keys left the "Still not fixed" note out (they hashed
 * words + note) move to the point's words-only key, so an older re-check
 * request keeps its reviews. A review already under the new key wins; a
 * point without a note has the same key either way.
 */
export function upgradeReviewKeys<R extends { key: string }>(points: readonly Pick<OutlinePoint, 'text' | 'tail'>[], reviews: readonly R[]): R[] {
  if (!reviews.length || !points.some(p => p.tail)) return [...reviews]
  const now = pointKeys(points.map(p => p.text))
  const before = pointKeys(points.map(pointFullText))
  const taken = new Set(reviews.map(r => r.key))
  const current = new Set(now)
  const move = new Map<string, string>()
  points.forEach((p, i) => {
    if (p.tail && before[i] !== now[i] && !taken.has(now[i]) && !current.has(before[i])) move.set(before[i], now[i])
  })
  return move.size ? reviews.map(r => (move.has(r.key) ? { ...r, key: move.get(r.key)! } : r)) : [...reviews]
}

/** The words + note keys each point had before (to recognise a re-check's older collected keys). */
export const legacyPointKeys = (points: readonly Pick<OutlinePoint, 'text' | 'tail'>[]): string[] => pointKeys(points.map(pointFullText))
