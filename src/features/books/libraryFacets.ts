// Browsing the library by author, collection (series), category and subject,
// and the "pick what is already in the library" suggestions used while typing.
// Pure and import-free (type-only); verified by scripts/verify-library-facets.cjs.

import type { Book } from './types'

export type FacetKind = 'author' | 'collection' | 'category' | 'subject'

/** Lower case without accents; ø/æ/ı/ß mapped by hand (they do not decompose). */
export function foldKey(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ı/g, 'i').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}

/** "A & B", "A; B" or one per line → each author. A "Last, First" name stays whole. */
export function splitAuthors(author: string | null | undefined): string[] {
  return (author ?? '').split(/\s*(?:&|;|\n)\s*/).map(a => a.trim()).filter(Boolean)
}

/** The values a book has for a facet. */
export function valuesOf(b: Book, kind: FacetKind): string[] {
  if (kind === 'author') return splitAuthors(b.author)
  if (kind === 'collection') return b.series?.trim() ? [b.series.trim()] : []
  if (kind === 'category') return (b.categories ?? []).map(c => c.trim()).filter(Boolean)
  return (b.subjects ?? []).map(c => c.trim()).filter(Boolean)
}

export interface Facet {
  key: string
  /** The spelling most books use (ties: the one with more capitals). */
  label: string
  books: Book[]
}

/** Every value of a facet across the books (news left out), the biggest first, then by name. */
export function facets(books: readonly Book[], kind: FacetKind): Facet[] {
  const map = new Map<string, { books: Book[]; spellings: Map<string, number> }>()
  for (const b of books) {
    if (b.kind === 'news') continue
    const seen = new Set<string>()
    for (const v of valuesOf(b, kind)) {
      const key = foldKey(v)
      if (!key || seen.has(key)) continue
      seen.add(key)
      const m = map.get(key) ?? { books: [] as Book[], spellings: new Map<string, number>() }
      m.books.push(b)
      m.spellings.set(v, (m.spellings.get(v) ?? 0) + 1)
      map.set(key, m)
    }
  }
  return [...map.entries()].map(([key, m]) => {
    let label = ''
    let best = 0
    // Most books' spelling; on a tie the one with more capitals ("Harry Potter" over "harry potter").
    const caps = (x: string) => (x.match(/\p{Lu}/gu) ?? []).length
    for (const [s, n] of m.spellings) if (n > best || (n === best && caps(s) > caps(label))) { best = n; label = s }
    return { key, label, books: kind === 'collection' ? seriesOrder(m.books) : m.books }
  }).sort((a, b) => b.books.length - a.books.length || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
}

/** A collection's books in series order (number first, then title); unnumbered ones last. */
export function seriesOrder(books: readonly Book[]): Book[] {
  const n = (b: Book) => {
    const x = Number(String(b.series_index ?? '').replace(',', '.'))
    return Number.isFinite(x) && String(b.series_index ?? '').trim() !== '' ? x : Infinity
  }
  return [...books].sort((a, b) => n(a) - n(b) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
}

/** The books that carry one facet value. */
export function booksWith(books: readonly Book[], kind: FacetKind, key: string): Book[] {
  const hit = books.filter(b => b.kind !== 'news' && valuesOf(b, kind).some(v => foldKey(v) === key))
  return kind === 'collection' ? seriesOrder(hit) : hit
}

/** How far through a collection you are: finished and reading counts. */
export function collectionProgress(books: readonly Book[]): { finished: number; reading: number; total: number } {
  return {
    finished: books.filter(b => b.read_status === 'finished').length,
    reading: books.filter(b => b.read_status === 'reading').length,
    total: books.length,
  }
}

/** Every distinct value already used for a field, in its most common spelling, A–Z. */
export function knownValues(books: readonly Book[], kind: FacetKind): string[] {
  return facets(books, kind).map(f => f.label).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/**
 * Existing values that match what is being typed: starts with first, then a
 * word that starts with it, then anywhere. Accents and case never matter, so
 * "jk row" finds "J. K. Rowling".
 */
export function suggest(values: readonly string[], typed: string, limit = 6): string[] {
  const q = foldKey(typed)
  if (!q) return []
  const scored: { v: string; s: number }[] = []
  for (const v of values) {
    const k = foldKey(v)
    if (!k || k === q) continue
    const compact = k.replace(/ /g, '')
    const s = k.startsWith(q) ? 0
      : k.split(' ').some(w => w.startsWith(q)) ? 1
        : k.includes(q) || compact.includes(q.replace(/ /g, '')) ? 2 : -1
    if (s >= 0) scored.push({ v, s })
  }
  return scored.sort((a, b) => a.s - b.s || a.v.length - b.v.length || a.v.localeCompare(b.v)).slice(0, limit).map(x => x.v)
}

/** Edit distance: insert, delete, change or swap two neighbouring letters (each 1), stopping early past `max`. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev2: number[] = []
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1)
      best = Math.min(best, cur[j])
    }
    if (best > max) return max + 1
    prev2 = prev
    prev = cur
  }
  return prev[b.length]
}

/**
 * A library value one or two letters away from what was typed ("Tolkein" →
 * "J. R. R. Tolkien" is too far, "Tolkein" → "Tolkien" is not): one letter for
 * 5–8 letters, two from 9. Null when it already matches or nothing is close.
 */
export function nearMatch(values: readonly string[], typed: string): string | null {
  const k = foldKey(typed)
  if (k.length < 5 || values.some(v => foldKey(v) === k)) return null
  const allowed = k.length >= 9 ? 2 : 1
  let best: string | null = null
  let bestD = allowed + 1
  for (const v of values) {
    const d = editDistance(k, foldKey(v), allowed)
    if (d < bestD) { best = v; bestD = d }
  }
  return best
}

/** The library's own spelling when the typed value matches one ignoring case and accents, else the typed value trimmed. */
export function canonical(values: readonly string[], typed: string): string {
  const t = typed.replace(/\s+/g, ' ').trim()
  const k = foldKey(t)
  return values.find(v => foldKey(v) === k) ?? t
}

/** A tag list cleaned for saving: trimmed, the library's spelling, no duplicates, at most 20. */
export function cleanTags(values: readonly string[], tags: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of tags) {
    const c = canonical(values, t).slice(0, 60)
    const k = foldKey(c)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(c)
    if (out.length >= 20) break
  }
  return out
}
