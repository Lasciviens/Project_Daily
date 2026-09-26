// Pure numbers for the Analytics screen (TgAnalyticsView). Every figure the
// screen shows is computed here from the page's own TgGame rows — the same
// cached library the shelves read, so opening Analytics fetches nothing.
//
// What the data can and cannot say: every provider (ES-DE, Steam,
// PlayStation) reports a LIFETIME play total and the date of the last session,
// never per-session records. So a time window selects the games you touched in
// it (played, started or finished) and shows their lifetime figures; it cannot
// say how many hours fell inside the window. The screen says so on its face.

import { hasPlayData, isRealSession } from '../../gameStats'
import {
  NO_PLATFORM, foldGenres, lastPlayedIso, platformCounts, platformLabels, playSeconds, starsFromRating,
  type PlatformCount, type TgGame,
} from '../testGameModel'

export type TgaWindow = 'all' | '12m' | 'year' | '90d' | '30d' | '7d'
export type TgaLibrary = 'all' | 'retro' | 'steam' | 'playstation'
export type TgaTab = 'overview' | 'play' | 'collection' | 'health'

/** `short` is the phone's label, where four tabs share one row. */
export const TGA_TABS: { key: TgaTab; label: string; short?: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'play', label: 'Play' },
  { key: 'collection', label: 'Collection' },
  { key: 'health', label: 'Data health', short: 'Health' },
]

export const TGA_WINDOWS: { key: TgaWindow; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'year', label: 'This year' },
  { key: '90d', label: 'Last 90 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '7d', label: 'Last 7 days' },
]

export const TGA_LIBRARIES: { key: TgaLibrary; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'retro', label: 'Retro' },
  { key: 'steam', label: 'Steam' },
  { key: 'playstation', label: 'PlayStation' },
]

/** The status mix's order: adjacent colours stay CVD-distinct (green↔red never touch). */
export const TGA_STATUSES = ['playing', 'completed', 'backlog', 'wishlist', 'dropped'] as const
export type TgaStatus = typeof TGA_STATUSES[number]

export function libraryOf(g: TgGame): Exclude<TgaLibrary, 'all'> {
  return g.library === 'steam' || g.library === 'playstation' ? g.library : 'retro'
}

/** Start of the window (local midnight, ms) or null for all time. */
export function windowStart(w: TgaWindow, today: number): number | null {
  const d = new Date(today)
  if (w === '7d') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 6).getTime()
  if (w === '30d') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29).getTime()
  if (w === '90d') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 89).getTime()
  // The month eleven back, so the window and the chart's twelve monthly columns agree.
  if (w === '12m') return new Date(d.getFullYear(), d.getMonth() - 11, 1).getTime()
  if (w === 'year') return new Date(d.getFullYear(), 0, 1).getTime()
  return null
}

/** The end of `today` (next local midnight, ms) — a date after it is in no window. */
export function windowEnd(today: number): number {
  const d = new Date(today)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
/** In [start, end): a missing start is all time, a missing end is open-ended. */
export const inWindow = (iso: string | null | undefined, start: number | null, end?: number | null) => {
  const t = at(iso)
  if (!Number.isFinite(t)) return false
  return (start == null || t >= start) && (end == null || t < end)
}

function touched(g: TgGame, start: number, end?: number | null): boolean {
  return inWindow(lastPlayedIso(g), start, end) || inWindow(g.finished_at, start, end) || inWindow(g.started_at, start, end)
}

/**
 * The ONE completion rule, shared by the tile, its drill-down and the chart:
 * status Completed and — inside a window — a finish date in [start, end).
 * A finish date on a game no longer Completed is history, not a completion;
 * a future date belongs to no window. All time counts every Completed game,
 * dated or not.
 */
export function isCompletion(g: TgGame, start: number | null, end?: number | null): boolean {
  if (g.play_status !== 'completed') return false
  return start == null ? true : inWindow(g.finished_at, start, end)
}

/** Visible games of one library (or all), before any time window. */
export function libraryGames(games: TgGame[], library: TgaLibrary): TgGame[] {
  return games.filter(g => !g.hidden && (library === 'all' || libraryOf(g) === library))
}

/** The games every card on the screen describes. */
export function scopeByWindow(games: TgGame[], start: number | null, end?: number | null): TgGame[] {
  return start == null ? games : games.filter(g => touched(g, start, end))
}

/** Started = recorded play, or a status that says you started it (Playing, Completed, Dropped). */
export function isStarted(g: TgGame): boolean {
  return hasPlayData(g) || g.play_status === 'playing' || g.play_status === 'completed' || g.play_status === 'dropped'
}

export interface TgaKpis {
  games: number
  platforms: number
  playing: number
  queued: number
  /** Status Completed (and, in a window, finished inside it) — `isCompletion`. */
  completed: number
  /** What `completed` is a share of: owned games, or the games played in the window. */
  completionBase: number
  playtimeSeconds: number
  playedGames: number
  avgStars: number | null
  rated: number
  backlog: number
  backlogUnplayed: number
  /** Games with recorded play (seconds, launches or a session date) — the Played tile. */
  played: number
  /** Games you've started (isStarted) — what an all-time completion rate is a share of. */
  started: number
  /** Playing, but no session in 60+ days (or none at all). Needs `today`. */
  stalePlaying: number
}

/** The headline tiles. Each tile's number is exactly its `tileGames` list. */
export type TgaTile = 'games' | 'playing' | 'completed' | 'playtime' | 'rating' | 'backlog' | 'played'

const byTitle = (a: TgGame, b: TgGame) => a.title.localeCompare(b.title)
const desc = (x: number, y: number) => (Number.isFinite(y) ? y : -Infinity) - (Number.isFinite(x) ? x : -Infinity)
const recency = (a: TgGame, b: TgGame) => desc(at(lastPlayedIso(a)), at(lastPlayedIso(b))) || byTitle(a, b)
const isBacklog = (g: TgGame) => g.play_status === 'backlog' || !g.play_status

/**
 * The games behind one tile, in the order the drill-down lists them. The tile
 * figures come from these same lists (computeKpis), so a list always adds up
 * to its tile. Completed follows `isCompletion`.
 */
export function tileGames(kind: TgaTile, scoped: TgGame[], start: number | null, end?: number | null): TgGame[] {
  switch (kind) {
    case 'games': return [...scoped].sort(recency)
    case 'playing': return scoped.filter(g => g.play_status === 'playing').sort(recency)
    case 'backlog': return scoped.filter(isBacklog).sort(recency)
    case 'completed':
      return scoped
        .filter(g => isCompletion(g, start, end))
        .sort((a, b) => desc(at(a.finished_at), at(b.finished_at)) || byTitle(a, b))
    case 'playtime':
      return scoped.filter(g => (playSeconds(g) ?? 0) > 0)
        .sort((a, b) => (playSeconds(b) ?? 0) - (playSeconds(a) ?? 0) || byTitle(a, b))
    case 'rating':
      return scoped.filter(g => starsFromRating(g.rating) != null)
        .sort((a, b) => (starsFromRating(b.rating) ?? 0) - (starsFromRating(a.rating) ?? 0) || byTitle(a, b))
    case 'played': return scoped.filter(g => hasPlayData(g)).sort(recency)
  }
}

/** Playing with no session in `days` days (or none recorded) — the importer promotes, it never demotes. */
export function isStalePlaying(g: TgGame, today: number, days = 60): boolean {
  if (g.play_status !== 'playing') return false
  const t = at(lastPlayedIso(g))
  return !Number.isFinite(t) || today - t >= days * 86_400_000
}

export function computeKpis(scoped: TgGame[], start: number | null, end?: number | null, today?: number): TgaKpis {
  const played = tileGames('playtime', scoped, null)
  const rated = tileGames('rating', scoped, null)
  const backlog = tileGames('backlog', scoped, null)
  const starSum = rated.reduce((n, g) => n + (starsFromRating(g.rating) ?? 0), 0)
  const wishlist = scoped.filter(g => g.play_status === 'wishlist').length
  return {
    games: scoped.length,
    // "No platform" is a bucket, not a platform you own.
    platforms: new Set(scoped.map(g => g.platformKey).filter(k => k !== NO_PLATFORM)).size,
    playing: tileGames('playing', scoped, start, end).length,
    queued: scoped.filter(g => g.play_order != null).length,
    backlog: backlog.length,
    backlogUnplayed: backlog.filter(g => (playSeconds(g) ?? 0) <= 0 && !lastPlayedIso(g)).length,
    completed: tileGames('completed', scoped, start, end).length,
    completionBase: start == null ? scoped.length - wishlist : scoped.length,
    playtimeSeconds: played.reduce((n, g) => n + (playSeconds(g) ?? 0), 0),
    playedGames: played.length,
    rated: rated.length,
    avgStars: rated.length ? Math.round((starSum / rated.length) * 100) / 100 : null,
    played: tileGames('played', scoped, null).length,
    started: scoped.filter(isStarted).length,
    stalePlaying: today == null ? 0 : scoped.filter(g => isStalePlaying(g, today)).length,
  }
}

export function statusMix(scoped: TgGame[]): { status: TgaStatus; count: number }[] {
  const m = new Map<TgaStatus, number>(TGA_STATUSES.map(s => [s, 0]))
  for (const g of scoped) {
    // No status is the import default nothing chose — the same as Backlog.
    const s = (g.play_status || 'backlog') as TgaStatus
    if (m.has(s)) m.set(s, (m.get(s) ?? 0) + 1)
  }
  return TGA_STATUSES.map(status => ({ status, count: m.get(status) ?? 0 }))
}

export interface TgaBarRow {
  key: string
  label: string
  count: number
  /** Null for a folded "Others" row, which has no single shelf to open. */
  target: string | null
  title?: string
  /** Two-tone bar: how much of `count` is filled (played, completed…). */
  part?: number
  /** Printed instead of `count` (play time, a share). */
  valueLabel?: string
}

/** The top `max` platforms by count, the rest folded into one row — unless only one is left over. */
export function platformRows(scoped: TgGame[], max = 10): { rows: TgaBarRow[]; counts: PlatformCount[] } {
  const counts = platformCounts(scoped)
  const labels = platformLabels(counts)
  const shown = counts.length <= max + 1 ? counts : counts.slice(0, max)
  const rest = counts.slice(shown.length)
  const rows: TgaBarRow[] = shown.map(c => ({ key: c.key, label: labels.get(c.key) ?? c.info.short, count: c.count, target: c.key }))
  if (rest.length) {
    rows.push({
      key: '__others', label: `${rest.length} more`, target: null,
      count: rest.reduce((n, c) => n + c.count, 0),
      title: rest.map(c => `${labels.get(c.key) ?? c.info.short} (${c.count})`).join(', '),
    })
  }
  return { rows, counts }
}

export function genreRows(scoped: TgGame[], max = 10): { rows: TgaBarRow[]; total: number; tagged: number } {
  // Case-folded like the library's genre filter (foldGenres), so "Action" and
  // "ACTION" from two sources are one bar and a tap filters both.
  const all = foldGenres(scoped, true)
  const tagged = scoped.filter(g => (g.genres ?? []).some(x => x.trim())).length
  return {
    rows: all.slice(0, max).map(({ genre, count }) => ({ key: genre, label: genre, count, target: genre })),
    total: all.length,
    tagged,
  }
}

export interface TgaPlayed { game: TgGame; seconds: number | null; last: string | null }

export function mostPlayed(scoped: TgGame[], n = 8): TgaPlayed[] {
  return scoped
    .map(game => ({ game, seconds: playSeconds(game), last: lastPlayedIso(game) }))
    .filter(x => (x.seconds ?? 0) > 0)
    .sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0) || a.game.title.localeCompare(b.game.title))
    .slice(0, n)
}

/** Latest sessions first. A launch shorter than five minutes (checking a ROM boots) is not play. */
export function recentlyPlayed(scoped: TgGame[], n = 8): TgaPlayed[] {
  return scoped
    .map(game => ({ game, seconds: playSeconds(game), last: lastPlayedIso(game) }))
    .filter(x => Number.isFinite(at(x.last)) && isRealSession(x.seconds))
    .sort((a, b) => at(b.last) - at(a.last))
    .slice(0, n)
}
