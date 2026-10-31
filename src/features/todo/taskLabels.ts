// A task's own labels (owner, 31.10.2026: "I should have an option to add other labels" — "My own labels"):
// any words the owner types ("Errands", "Phone", "Kitchen scale"), several per task, a chip on the row.
// The database keeps them cleaned by ONE rule (migration 180, task_labels_clean, on every write); this is its
// copy for the browser, so the sheet shows what will be stored. verify-db-task-labels compares the two.

/** At most this many characters per label. */
export const LABEL_MAX = 30
/** At most this many labels per task (the first ones kept). */
export const LABELS_PER_TASK = 10

// Control characters become spaces, runs of spaces one space; only plain spaces are trimmed (as SQL's btrim).
// eslint-disable-next-line no-control-regex -- matching control characters is the point (the database's [\u0001-\u001f\u007f])
const CONTROL = /[\u0000-\u001F\u007F]/g
const trimSpaces = (s: string) => s.replace(/^ +| +$/g, '')

/** One label as stored: control characters out, spaces squashed and trimmed, cut at 30 characters (not UTF-16 units). */
export function cleanLabel(raw: string): string {
  const once = trimSpaces(raw.replace(CONTROL, ' ').replace(/ {2,}/g, ' '))
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
  const starts = free.filter(l => l.toLowerCase().startsWith(q))
  const inside = free.filter(l => !l.toLowerCase().startsWith(q) && l.toLowerCase().includes(q))
  return [...starts, ...inside].slice(0, limit)
}
