// Pure play-statistics helpers for the Games feature.
//
// ES-DE is the only source of real play data in this app (`esde_playcount`,
// `esde_playtime_seconds`, `esde_last_played`, migration 089's roll-up across
// a game's variants). Until now the detail modal was the ONLY place any of it
// appeared, and it printed `Math.round(seconds / 3600)h` — so a 40-minute
// session read as "0h", which looks exactly like "never played".
//
// Import-free on purpose (the `progressAggregate.ts` convention) so
// `scripts/verify-game-stats.cjs` can require it through sucrase.

export type PlayStatRow = {
  id: string
  title: string
  esde_playcount: number | null
  esde_playtime_seconds: number | null
  esde_last_played: string | null
}

/** "2h 14m" · "45m" · "3m" · null when there is genuinely nothing to show. */
export function formatPlaytime(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  // Floor, not round: 30 seconds must not read as a full minute, and the
  // "<1m" branch below is only reachable if it can actually land on zero.
  const total = Math.floor(seconds / 60)
  const h = Math.floor(total / 60)
  const m = total % 60
  // Under a minute is still real play time — never round it away to nothing.
  if (h === 0 && m === 0) return '<1m'
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

/** Compact form for a card corner, where "2h 14m" is too wide: "2h" · "45m". */
export function formatPlaytimeShort(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return formatPlaytime(seconds)
  return `${Math.floor(minutes / 60)}h`
}

export function hasPlayData(g: Pick<PlayStatRow, 'esde_playcount' | 'esde_playtime_seconds' | 'esde_last_played'>): boolean {
  return (g.esde_playcount ?? 0) > 0
    || (g.esde_playtime_seconds ?? 0) > 0
    || !!g.esde_last_played
}

export type PlaytimeStats = {
  totalSeconds: number
  playedCount: number
  neverPlayedCount: number
  /** Null when nothing has any recorded play time at all. */
  lastPlayed: string | null
  topPlayed: { id: string; title: string; seconds: number; playcount: number | null }[]
}

/**
 * Roll the library's own ES-DE stats up. `neverPlayedCount` counts every row
 * with no play signal — including rows ES-DE has simply never reported on, so
 * it reads as "no recorded play", not as a claim that the game was never run.
 */
export function computePlaytimeStats(rows: PlayStatRow[], topN = 5): PlaytimeStats {
  let totalSeconds = 0
  let playedCount = 0
  let lastPlayed: string | null = null

  for (const r of rows) {
    const secs = r.esde_playtime_seconds ?? 0
    if (Number.isFinite(secs) && secs > 0) totalSeconds += secs
    if (hasPlayData(r)) playedCount++
    if (r.esde_last_played && (!lastPlayed || r.esde_last_played > lastPlayed)) lastPlayed = r.esde_last_played
  }

  const topPlayed = rows
    .filter(r => (r.esde_playtime_seconds ?? 0) > 0)
    .sort((a, b) => (b.esde_playtime_seconds ?? 0) - (a.esde_playtime_seconds ?? 0))
    .slice(0, topN)
    .map(r => ({ id: r.id, title: r.title, seconds: r.esde_playtime_seconds ?? 0, playcount: r.esde_playcount }))

  return { totalSeconds, playedCount, neverPlayedCount: rows.length - playedCount, lastPlayed, topPlayed }
}

/**
 * A game only counts as "recently played" once it has at least this much
 * recorded time. ES-DE records a total and a launch count, never per-session
 * durations, so "was the LAST session at least 5 minutes" is not answerable
 * from this data — this is the honest approximation of it: a title opened for
 * a few seconds to check it boots never outranks one actually played.
 */
export const MIN_REAL_PLAY_SECONDS = 300

export function isRealPlay(seconds: number | null | undefined): boolean {
  return (seconds ?? 0) >= MIN_REAL_PLAY_SECONDS
}

/**
 * Most recently played first, among games with real recorded play. Everything
 * else keeps its own relative order BELOW that block rather than being
 * filtered out — a sort must never remove rows (CLAUDE.md's NEVER_HIDES).
 */
export function sortByRecentlyPlayed<T extends { esde_last_played: string | null; esde_playtime_seconds: number | null }>(
  games: T[],
): T[] {
  const real = games.filter(g => isRealPlay(g.esde_playtime_seconds) && g.esde_last_played)
  const rest = games.filter(g => !(isRealPlay(g.esde_playtime_seconds) && g.esde_last_played))
  real.sort((a, b) => (b.esde_last_played ?? '').localeCompare(a.esde_last_played ?? ''))
  return [...real, ...rest]
}
