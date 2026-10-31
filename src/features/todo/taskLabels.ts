// A task's own labels (owner, 31.10.2026: "I should have an option to add other labels" — "My own labels"):
// any words the owner types ("Errands", "Phone", "Kitchen scale"), several per task, a chip on the row.
// The database keeps them cleaned by ONE rule (migration 180, task_labels_clean, on every write); this is its
// copy for the browser, so the sheet shows what will be stored. verify-db-task-labels compares the two.

/** At most this many characters per label. */
export const LABEL_MAX = 30
/** At most this many labels per task (the first ones kept). */
export const LABELS_PER_TASK = 10

// Invisible and direction-changing characters go (a right-to-left override could reorder the row a label sits
// on); control characters and odd spaces become plain spaces, runs of spaces one; only plain spaces are trimmed
// (as SQL's btrim). The same classes as 180's task_labels_clean — keep the two identical.
const INVISIBLE = /[\u00AD\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const SPACE_LIKE = /[\u0000-\u001F\u007F-\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g
const trimSpaces = (s: string) => s.replace(/^ +| +$/g, '')

/** One label as stored: invisible characters out, odd spaces plain, squashed and trimmed, cut at 30 characters (not UTF-16 units). */
export function cleanLabel(raw: string): string {
  const once = trimSpaces(raw.replace(INVISIBLE, '').replace(SPACE_LIKE, ' ').replace(/ {2,}/g, ' '))
  return trimSpaces(Array.from(once).slice(0, LABEL_MAX).join(''))
}

/** A task's labels as stored: each cleaned, empty and repeated ones (any case) out — the first kept — at most 10. */
export function cleanLabels(list: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    if (typeof raw !== 'string') continue
    const label = cleanLabel(raw)
    const key = label.toLowerCase()
    if (!label || seen.has(key)) continue
    seen.add(key)
    out.push(label)
    if (out.length === LABELS_PER_TASK) break
  }
  return out
}

/** The labels a row read from the database carries (an older database has no column: none). */
export function labelsOf(row: { labels?: unknown }): string[] {
  return Array.isArray(row.labels) ? row.labels.filter((l): l is string => typeof l === 'string') : []
}

/** Suggestions while typing: the owner's labels that start with (then contain) the text, not already on the task. */
export function labelSuggestions(known: readonly string[], typed: string, chosen: readonly string[], limit = 6): string[] {
  const q = cleanLabel(typed).toLowerCase()
  const taken = new Set(chosen.map(l => l.toLowerCase()))
  const free = known.filter(l => !taken.has(l.toLowerCase()))
  if (!q) return free.slice(0, limit)
  // The exact label first (Enter on "Phone" picks Phone, never the more used "Phone call"), then the ones that start
  // with the text, then the ones that contain it.
  const exact = free.filter(l => l.toLowerCase() === q)
  const starts = free.filter(l => l.toLowerCase() !== q && l.toLowerCase().startsWith(q))
  const inside = free.filter(l => !l.toLowerCase().startsWith(q) && l.toLowerCase().includes(q))
  return [...exact, ...starts, ...inside].slice(0, limit)
}
