// Games settings that sync across devices (migration 133, games_prefs).
// Pure and import-free (scripts/verify-games-prefs.cjs).

export interface GamesPrefs {
  /** Platform keys (TgGame.platformKey) left out of every stat, count and batch. */
  excludedPlatforms: string[]
}

export function defaultGamesPrefs(): GamesPrefs {
  return { excludedPlatforms: [] }
}

/** A stored jsonb doc → clean prefs (unknown keys dropped, keys deduped and sorted). */
export function normalizeGamesPrefs(raw: unknown): GamesPrefs {
  const doc = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(doc.excluded_platforms) ? doc.excluded_platforms
    : Array.isArray(doc.excludedPlatforms) ? doc.excludedPlatforms : []
  const keys = [...new Set(list
    .filter((k): k is string => typeof k === 'string')
    .map(k => k.trim())
    .filter(k => k !== '' && k !== 'all'))].sort()
  return { excludedPlatforms: keys }
}

/** The jsonb doc to store. */
export function gamesPrefsDoc(p: GamesPrefs): Record<string, unknown> {
  return { excluded_platforms: normalizeGamesPrefs({ excluded_platforms: p.excludedPlatforms }).excludedPlatforms }
}

/** The games that count: every game whose platform isn't left out. */
export function countedGames<T extends { platformKey: string }>(games: T[], excluded: readonly string[]): T[] {
  if (excluded.length === 0) return games
  const out = new Set(excluded)
  return games.filter(g => !out.has(g.platformKey))
}
