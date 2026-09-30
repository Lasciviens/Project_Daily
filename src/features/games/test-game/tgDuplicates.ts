// Possible duplicates in the library: the same title (after dropping region
// tags, punctuation and case) or the same cover picture on two or more games.
// Pure and import-free (scripts/verify-test-game-model.cjs). Nothing here
// decides — a PS4 and a Steam copy of one game are listed too, labelled by
// library/platform, so the owner can tell a real duplicate from two copies.

export interface DupGame { id: string; title: string; primary_cover_url?: string | null; platformKey: string; library: string; hidden?: boolean }
export interface DupGroup<G extends DupGame = DupGame> {
  reason: 'title' | 'image'
  /** The shared normalized title, or the shared picture's URL. */
  key: string
  games: G[]
  /** Every copy sits on the same platform — the most likely real duplicates. */
  samePlatform: boolean
}

/** "The Legend of Zelda: Ocarina of Time (USA) [!]" → "legend of zelda ocarina of time" */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/[™®©]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim()
}

function groupBy<G extends DupGame>(games: readonly G[], keyOf: (g: G) => string | null, reason: DupGroup['reason']): DupGroup<G>[] {
  const m = new Map<string, G[]>()
  for (const g of games) {
    const k = keyOf(g)
    if (!k) continue
    const list = m.get(k)
    if (list) list.push(g); else m.set(k, [g])
  }
  return [...m].filter(([, gs]) => gs.length > 1).map(([key, gs]) => ({
    reason, key, games: gs, samePlatform: new Set(gs.map(g => g.platformKey)).size === 1,
  }))
}

/**
 * Title groups first, then picture groups that don't just repeat a title
 * group; within each kind, same-platform groups (likelier real duplicates)
 * lead, then bigger groups, then A–Z.
 */
export function findDuplicates<G extends DupGame>(games: readonly G[]): DupGroup<G>[] {
  const byTitle = groupBy(games, g => normalizeTitle(g.title) || null, 'title')
  const titleSets = new Set(byTitle.map(g => g.games.map(x => x.id).sort().join('|')))
  const byImage = groupBy(games, g => g.primary_cover_url?.trim() || null, 'image')
    .filter(g => !titleSets.has(g.games.map(x => x.id).sort().join('|')))
  const order = (a: DupGroup<G>, b: DupGroup<G>) =>
    Number(b.samePlatform) - Number(a.samePlatform) || b.games.length - a.games.length || a.games[0].title.localeCompare(b.games[0].title)
  return [...byTitle.sort(order), ...byImage.sort(order)]
}
