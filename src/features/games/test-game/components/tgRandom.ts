// "Pick a random game": one game drawn uniformly from what the page is showing.

/**
 * A random id from `games`, or null when there is nothing to pick. The game
 * already open (`currentId`) is left out when there is anything else, so a
 * second press always lands somewhere new. `rand` is injectable for tests.
 */
export function pickRandomId(
  games: readonly { id: string }[], currentId: string | null = null, rand: () => number = Math.random,
): string | null {
  const pool = games.length > 1 && currentId != null ? games.filter(g => g.id !== currentId) : games
  if (pool.length === 0) return null
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))].id
}
