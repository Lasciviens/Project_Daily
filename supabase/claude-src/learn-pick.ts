// ─────────────────────────────────────────────────────────────────────────────
//  The `claude` function · learning: picking past cases as examples (pure)
//
//  The database finds the candidates (full-text search plus pg_trgm similarity, `ai_case_candidates`); this part picks
//  the 2–3 that go with a call:
//    · `knn`  — the most similar ones;
//    · `mmr`  — maximal marginal relevance: each next pick is similar to the input but NOT to the ones already picked,
//               so three near-copies of one past answer never fill the block;
//    · `none` — no examples (the baseline the weekly self-test compares with).
//  A candidate below a floor of similarity is never sent: an unrelated example teaches the wrong thing.
//  The trigram measure here is pg_trgm's (words padded with two spaces in front and one behind, lower case), so the code's
//  diversity step and the database's ranking speak the same language. No imports: the verify scripts run it as it is.
// ─────────────────────────────────────────────────────────────────────────────

export type ExampleStrategy = 'none' | 'knn' | 'mmr'
export const EXAMPLE_STRATEGIES: readonly ExampleStrategy[] = ['none', 'knn', 'mmr']

export interface CaseCandidate {
  id: string
  input_text: string
  output: Record<string, unknown>
  /** The database's own relevance (ts_rank + similarity); the code works its own similarity out again. */
  relevance?: number
}

export const PICK_LIMITS = { kMax: 5, floor: 0.12, lambda: 0.5, candidates: 30 } as const

/** pg_trgm's trigrams of a text: lower case, each word (letters and digits) padded "  word ". */
export function trigramsOf(text: string): Set<string> {
  const out = new Set<string>()
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const padded = `  ${word} `
    const chars = [...padded]
    for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(''))
  }
  return out
}

/** pg_trgm's similarity: shared trigrams over all distinct trigrams of both (0 to 1). */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigramsOf(a)
  const y = trigramsOf(b)
  if (x.size === 0 || y.size === 0) return 0
  let shared = 0
  for (const t of x) if (y.has(t)) shared += 1
  return shared / (x.size + y.size - shared)
}

/**
 * The examples for one call. `exclude`: ids never to pick (the case being replayed in the self-test is never its own
 * example). Answers the picked candidates in the order chosen.
 */
export function pickExamples(
  query: string, candidates: readonly CaseCandidate[], strategy: ExampleStrategy, k: number,
  options: { exclude?: ReadonlySet<string>; floor?: number; lambda?: number } = {},
): CaseCandidate[] {
  const want = Math.max(0, Math.min(Math.floor(Number.isFinite(k) ? k : 0), PICK_LIMITS.kMax))
  if (strategy === 'none' || want === 0 || !query.trim()) return []
  const floor = options.floor ?? PICK_LIMITS.floor
  const lambda = options.lambda ?? PICK_LIMITS.lambda
  const seen = new Set<string>()
  const pool = candidates
    .filter(c => !options.exclude?.has(c.id) && !seen.has(c.id) && seen.add(c.id))
    .slice(0, PICK_LIMITS.candidates)
    .map(c => ({ c, sim: trigramSimilarity(query, c.input_text) }))
    .filter(x => x.sim >= floor)
  if (strategy === 'knn') return pool.sort((a, b) => b.sim - a.sim).slice(0, want).map(x => x.c)
  const chosen: { c: CaseCandidate; sim: number }[] = []
  while (chosen.length < want && pool.length) {
    let best = -1
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      const redundancy = chosen.length ? Math.max(...chosen.map(x => trigramSimilarity(pool[i].c.input_text, x.c.input_text))) : 0
      const score = lambda * pool[i].sim - (1 - lambda) * redundancy
      if (score > bestScore) { bestScore = score; best = i }
    }
    chosen.push(pool.splice(best, 1)[0])
  }
  return chosen.map(x => x.c)
}
