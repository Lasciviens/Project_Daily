import { fold } from './shopModel'

// Adding several things to the quick list at once (the week's groceries, a
// project's "To buy" rows): pure, so scripts/verify-quick-batch.cjs checks it.
// A thing already on the list is never added twice — compared by its folded
// title, the way the rest of Shop compares titles.

/** The titles of the quick list's open rows, folded for comparing. */
export function foldedTitles(titles: readonly string[]): Set<string> {
  return new Set(titles.map(fold).filter(Boolean))
}

/**
 * What to add and what to leave: `wanted` without the rows whose title is
 * already on the list, and without a second copy of one title inside the
 * batch itself.
 */
export function splitNew<T extends { title: string }>(wanted: readonly T[], onList: ReadonlySet<string>): { fresh: T[]; skipped: T[] } {
  const seen = new Set(onList)
  const fresh: T[] = []
  const skipped: T[] = []
  for (const w of wanted) {
    const key = fold(w.title)
    if (!key || seen.has(key)) { skipped.push(w); continue }
    seen.add(key)
    fresh.push(w)
  }
  return { fresh, skipped }
}

/** "Added 5 items to the quick list · Week 48 · 2 already there" (the toast's words before Undo). */
export function batchWords(added: number, skipped: number, what: string): string {
  const parts = [`Added ${added} ${added === 1 ? 'item' : 'items'} to the quick list${what ? ` · ${what}` : ''}`]
  if (skipped > 0) parts.push(`${skipped} already there`)
  return parts.join(' · ')
}
