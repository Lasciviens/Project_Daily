// Pure search helpers for the food logger — import-free so
// scripts/verify-food-search.cjs can require it through sucrase.

/** Lower-case, strip accents, and fold the Nordic/Turkish letters NFD can't split. */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/ß/g, 'ss').replace(/ı/g, 'i').replace(/đ/g, 'd')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim()
}

/**
 * How well `name` matches the query (already folded): 0 exact · 1 starts with ·
 * 2 a word starts with · 3 contains · null no match. Lower is better.
 */
export function matchRank(name: string, foldedQuery: string): number | null {
  if (!foldedQuery) return null
  const n = foldText(name)
  if (n === foldedQuery) return 0
  if (n.startsWith(foldedQuery)) return 1
  if (n.split(/[\s,()/-]+/).some(w => w.startsWith(foldedQuery))) return 2
  if (n.includes(foldedQuery)) return 3
  return null
}

/** Sorts items by match rank (then shorter name first), dropping non-matches. */
export function rankMatches<T>(items: T[], query: string, nameOf: (t: T) => string, limit = 20): T[] {
  const fq = foldText(query)
  if (!fq) return []
  return items
    .map(item => ({ item, rank: matchRank(nameOf(item), fq), len: nameOf(item).length }))
    .filter((x): x is { item: T; rank: number; len: number } => x.rank != null)
    .sort((a, b) => a.rank - b.rank || a.len - b.len)
    .slice(0, limit)
    .map(x => x.item)
}

/**
 * "kebab 700" → { title: 'kebab', kcal: 700 } — a trailing number (optionally
 * followed by "kcal"/"cal") is read as calories for a one-off entry.
 */
export function parseQuickAdd(raw: string): { title: string; kcal: number | null } {
  const s = raw.trim()
  const m = s.match(/^(.*\S)\s+(\d{1,4}(?:[.,]\d+)?)\s*(?:kcal|cal)?$/i)
  if (m && m[1].trim()) return { title: m[1].trim(), kcal: Math.round(Number(m[2].replace(',', '.'))) }
  return { title: s, kcal: null }
}

interface SlotAware { count: number; slotCounts?: Partial<Record<string, number>> }

/** Recents ordered for one meal slot: what you usually eat THEN, then overall. */
export function sortForSlot<T extends SlotAware>(items: T[], slot: string): T[] {
  return [...items].sort((a, b) => (b.slotCounts?.[slot] ?? 0) - (a.slotCounts?.[slot] ?? 0) || b.count - a.count)
}

/** The items you log in this slot most of the time (≥ minTimes, and it's their main slot). */
export function usualForSlot<T extends SlotAware>(items: T[], slot: string, minTimes = 3): T[] {
  return items.filter(i => {
    const n = i.slotCounts?.[slot] ?? 0
    return n >= minTimes && n * 2 > i.count
  })
}
