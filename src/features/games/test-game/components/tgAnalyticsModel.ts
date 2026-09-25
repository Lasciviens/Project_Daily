// Pure numbers for the Analytics screen (TgAnalyticsView). Every figure the
// screen shows is computed here from the page's own TgGame rows — the same
// cached library the shelves read, so opening Analytics fetches nothing.
//
// What the data can and cannot say: every provider (ES-DE, Steam,
// PlayStation) reports a LIFETIME play total and the date of the last session,
// never per-session records. So a time window selects the games you touched in
// it (played, started or finished) and shows their lifetime figures; it cannot
// say how many hours fell inside the window. The screen says so on its face.

import { isRealPlay } from '../../gameStats'
import {
  lastPlayedIso, platformCounts, platformLabels, playSeconds, starsFromRating,
  type PlatformCount, type TgGame,
} from '../testGameModel'

export type TgaWindow = 'all' | '12m' | 'year' | '30d'
export type TgaLibrary = 'all' | 'retro' | 'steam' | 'playstation'

export const TGA_WINDOWS: { key: TgaWindow; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'year', label: 'This year' },
  { key: '30d', label: 'Last 30 days' },
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
  if (w === '30d') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29).getTime()
  // The month eleven back, so the window and the chart's twelve monthly columns agree.
  if (w === '12m') return new Date(d.getFullYear(), d.getMonth() - 11, 1).getTime()
  if (w === 'year') return new Date(d.getFullYear(), 0, 1).getTime()
  return null
}

const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
export const inWindow = (iso: string | null | undefined, start: number | null) =>
  start == null ? !!iso && Number.isFinite(at(iso)) : at(iso) >= start

function touched(g: TgGame, start: number): boolean {
  return inWindow(lastPlayedIso(g), start) || inWindow(g.finished_at, start) || inWindow(g.started_at, start)
}

/** Visible games of one library (or all), before any time window. */
export function libraryGames(games: TgGame[], library: TgaLibrary): TgGame[] {
  return games.filter(g => !g.hidden && (library === 'all' || libraryOf(g) === library))
}

/** The games every card on the screen describes. */
export function scopeByWindow(games: TgGame[], start: number | null): TgGame[] {
  return start == null ? games : games.filter(g => touched(g, start))
}

export interface TgaKpis {
  games: number
  platforms: number
  playing: number
  queued: number
  /** All time: status Completed. A window: finished inside it. */
  completed: number
  /** What `completed` is a share of: owned games, or the games played in the window. */
  completionBase: number
  playtimeSeconds: number
  playedGames: number
  avgStars: number | null
  rated: number
  backlog: number
  backlogUnplayed: number
}

/** The six headline tiles. Each tile's number is exactly its `tileGames` list. */
export type TgaTile = 'games' | 'playing' | 'completed' | 'playtime' | 'rating' | 'backlog'

const byTitle = (a: TgGame, b: TgGame) => a.title.localeCompare(b.title)
const desc = (x: number, y: number) => (Number.isFinite(y) ? y : -Infinity) - (Number.isFinite(x) ? x : -Infinity)
const recency = (a: TgGame, b: TgGame) => desc(at(lastPlayedIso(a)), at(lastPlayedIso(b))) || byTitle(a, b)
const isBacklog = (g: TgGame) => g.play_status === 'backlog' || !g.play_status

/**
 * The games behind one tile, in the order the drill-down lists them. The tile
 * figures come from these same lists (computeKpis), so a list always adds up
 * to its tile. Completed: all time = status Completed; a window = finished in it.
 */
export function tileGames(kind: TgaTile, scoped: TgGame[], start: number | null): TgGame[] {
  switch (kind) {
    case 'games': return [...scoped].sort(recency)
    case 'playing': return scoped.filter(g => g.play_status === 'playing').sort(recency)
    case 'backlog': return scoped.filter(isBacklog).sort(recency)
    case 'completed':
      return scoped
        .filter(g => (start == null ? g.play_status === 'completed' : inWindow(g.finished_at, start)))
        .sort((a, b) => desc(at(a.finished_at), at(b.finished_at)) || byTitle(a, b))
    case 'playtime':
      return scoped.filter(g => (playSeconds(g) ?? 0) > 0)
        .sort((a, b) => (playSeconds(b) ?? 0) - (playSeconds(a) ?? 0) || byTitle(a, b))
    case 'rating':
      return scoped.filter(g => starsFromRating(g.rating) != null)
        .sort((a, b) => (starsFromRating(b.rating) ?? 0) - (starsFromRating(a.rating) ?? 0) || byTitle(a, b))
  }
}

export function computeKpis(scoped: TgGame[], start: number | null): TgaKpis {
  const played = tileGames('playtime', scoped, null)
  const rated = tileGames('rating', scoped, null)
  const backlog = tileGames('backlog', scoped, null)
  const starSum = rated.reduce((n, g) => n + (starsFromRating(g.rating) ?? 0), 0)
  const wishlist = scoped.filter(g => g.play_status === 'wishlist').length
  return {
    games: scoped.length,
    platforms: new Set(scoped.map(g => g.platformKey)).size,
    playing: tileGames('playing', scoped, start).length,
    queued: scoped.filter(g => g.play_order != null).length,
    backlog: backlog.length,
    backlogUnplayed: backlog.filter(g => (playSeconds(g) ?? 0) <= 0 && !lastPlayedIso(g)).length,
    completed: tileGames('completed', scoped, start).length,
    completionBase: start == null ? scoped.length - wishlist : scoped.length,
    playtimeSeconds: played.reduce((n, g) => n + (playSeconds(g) ?? 0), 0),
    playedGames: played.length,
    rated: rated.length,
    avgStars: rated.length ? Math.round((starSum / rated.length) * 100) / 100 : null,
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
  const m = new Map<string, number>()
  let tagged = 0
  for (const g of scoped) {
    const set = new Set((g.genres ?? []).map(s => s.trim()).filter(Boolean))
    if (set.size) tagged++
    for (const x of set) m.set(x, (m.get(x) ?? 0) + 1)
  }
  const all = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return {
    rows: all.slice(0, max).map(([genre, count]) => ({ key: genre, label: genre, count, target: genre })),
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
    .filter(x => Number.isFinite(at(x.last)) && (x.seconds == null || isRealPlay(x.seconds)))
    .sort((a, b) => at(b.last) - at(a.last))
    .slice(0, n)
}
