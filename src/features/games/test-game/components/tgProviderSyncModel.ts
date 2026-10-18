import type { TgGame } from '../testGameModel'

/** The newest sync of a provider library's rows, or null. */
export function lastSynced(games: readonly TgGame[], library: 'steam' | 'playstation'): string | null {
  let best: string | null = null
  for (const g of games) if (g.library === library && g.synced_at && (!best || g.synced_at > best)) best = g.synced_at
  return best
}

const DAY_MS = 24 * 3600_000

/**
 * The once-a-day sync on opening Games (owner, 05.10.2026): due when the
 * library's newest sync AND the last attempt (a failed one too, so a broken
 * connection is not retried on every visit) are both over a day old. A
 * library with no rows yet was never imported — that stays an explicit tap.
 */
export function autoSyncDue(lastSync: string | null, lastAttempt: number | null, now: number): boolean {
  if (!lastSync) return false
  const age = now - Date.parse(lastSync)
  return Number.isFinite(age) && age > DAY_MS && (lastAttempt == null || now - lastAttempt > DAY_MS)
}
