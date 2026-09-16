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

/**
 * Play statistics as any provider reports them.
 *
 * Migration 096 added the source-neutral trio (`play_seconds`/`play_count`/
 * `last_played_at`) so a library mixing ES-DE, Steam and PlayStation totals
 * without every row needing a different column read. The `esde_*` fields are kept
 * as the fallback: until 096 is applied they are the only figures there are,
 * and after it they still hold ES-DE's own copy.
 */
export type PlayStatRow = {
  id: string
  title: string
  play_seconds?: number | null
  play_count?: number | null
  last_played_at?: string | null
  esde_playcount?: number | null
  esde_playtime_seconds?: number | null
  esde_last_played?: string | null
}

export type ResolvedPlay = { seconds: number | null; count: number | null; last: string | null }

/** The neutral columns win; ES-DE's are the pre-migration-096 fallback. */
export function playStatsOf(g: PlayStatRow): ResolvedPlay {
  return {
    seconds: g.play_seconds ?? g.esde_playtime_seconds ?? null,
    count:   g.play_count ?? g.esde_playcount ?? null,
    last:    g.last_played_at ?? g.esde_last_played ?? null,
  }
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

export function hasPlayData(g: PlayStatRow): boolean {
  const p = playStatsOf(g)
  return (p.count ?? 0) > 0 || (p.seconds ?? 0) > 0 || !!p.last
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
    const p = playStatsOf(r)
    const secs = p.seconds ?? 0
    if (Number.isFinite(secs) && secs > 0) totalSeconds += secs
    if (hasPlayData(r)) playedCount++
    if (p.last && (!lastPlayed || p.last > lastPlayed)) lastPlayed = p.last
  }

  const topPlayed = rows
    .map(r => ({ row: r, p: playStatsOf(r) }))
    .filter(x => (x.p.seconds ?? 0) > 0)
    .sort((a, b) => (b.p.seconds ?? 0) - (a.p.seconds ?? 0))
    .slice(0, topN)
    .map(x => ({ id: x.row.id, title: x.row.title, seconds: x.p.seconds ?? 0, playcount: x.p.count }))

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
export function sortByRecentlyPlayed<T extends PlayStatRow>(games: T[]): T[] {
  const ranked = (g: T) => { const p = playStatsOf(g); return isRealPlay(p.seconds) && p.last ? p.last : null }
  const real = games.filter(g => ranked(g) !== null)
  const rest = games.filter(g => ranked(g) === null)
  real.sort((a, b) => (ranked(b) ?? '').localeCompare(ranked(a) ?? ''))
  return [...real, ...rest]
}

// ─── Stats scoping (migration 096) ──────────────────────────────────────────

export type StatsWindow = '7d' | '30d' | '90d' | '365d' | 'all'

export const STATS_WINDOWS: { key: StatsWindow; label: string; days: number | null }[] = [
  { key: '7d',   label: 'Last week',    days: 7 },
  { key: '30d',  label: 'Last 30 days', days: 30 },
  { key: '90d',  label: 'Last 3 months', days: 90 },
  { key: '365d', label: 'Last year',    days: 365 },
  { key: 'all',  label: 'All time',     days: null },
]

/**
 * Games PLAYED inside the window.
 *
 * Be clear about what this can and cannot mean: every provider here reports a
 * LIFETIME total and the date of the last session — never per-session records.
 * So a window selects the games touched in it and shows their lifetime figures;
 * it cannot say how many hours fell inside the window itself. The Stats panel
 * says so on screen rather than implying a precision the data has not got.
 *
 * A game with no last-played date is out of every window except "all time" —
 * there is no date on which to include it.
 */
export function withinWindow<T extends PlayStatRow>(games: T[], window: StatsWindow, now = new Date()): T[] {
  const spec = STATS_WINDOWS.find(w => w.key === window)
  if (!spec || spec.days == null) return games
  const cutoff = new Date(now.getTime() - spec.days * 86400_000).toISOString()
  return games.filter(g => {
    const last = playStatsOf(g).last
    return !!last && last >= cutoff
  })
}

// ─── Library-wide aggregation ───────────────────────────────────────────────
// Lives here rather than in the API layer because the Stats panel now filters
// by window and by library before totalling — the numbers depend on what the
// user picked, not on what the query returned.

export type StatsRow = PlayStatRow & {
  play_status: string
  is_iconic: boolean
  is_coop: boolean
  needs_review: boolean
  rating: number | null
  library?: string | null
}

export type GameStatsShape = {
  total: number
  playing: number
  completed: number
  wishlist: number
  backlog: number
  dropped: number
  iconic: number
  coop: number
  needsReview: number
  avgRating: number | null
  bySystem: { system: string; count: number }[]
  playtime: PlaytimeStats
}

export function computeGameStats(
  rows: StatsRow[],
  platforms: { game_id?: string; system: string }[] = [],
): GameStatsShape {
  const rated = rows.filter(r => r.rating != null)
  const ids = new Set(rows.map(r => r.id))
  const bySystemMap = new Map<string, number>()
  for (const p of platforms) {
    // A platform row only counts when its game is in the current scope —
    // otherwise a library filter would change every total EXCEPT this one.
    if (p.game_id && !ids.has(p.game_id)) continue
    bySystemMap.set(p.system, (bySystemMap.get(p.system) ?? 0) + 1)
  }
  const count = (s: string) => rows.filter(r => r.play_status === s).length
  return {
    total: rows.length,
    playing: count('playing'),
    completed: count('completed'),
    wishlist: count('wishlist'),
    backlog: count('backlog'),
    dropped: count('dropped'),
    iconic: rows.filter(r => r.is_iconic).length,
    coop: rows.filter(r => r.is_coop).length,
    needsReview: rows.filter(r => r.needs_review).length,
    avgRating: rated.length
      ? Math.round((rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length) * 10) / 10
      : null,
    bySystem: [...bySystemMap.entries()].map(([system, count]) => ({ system, count })).sort((a, b) => b.count - a.count),
    playtime: computePlaytimeStats(rows),
  }
}

export const LIBRARY_LABEL: Record<string, string> = {
  retro: 'Retro', steam: 'Steam', playstation: 'PlayStation',
}
