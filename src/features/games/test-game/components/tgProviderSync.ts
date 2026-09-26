import type { TgGame } from '../testGameModel'

/** The newest sync of a provider library's rows, or null. */
export function lastSynced(games: readonly TgGame[], library: 'steam' | 'playstation'): string | null {
  let best: string | null = null
  for (const g of games) if (g.library === library && g.synced_at && (!best || g.synced_at > best)) best = g.synced_at
  return best
}
