// Pure numbers for the Analytics Play and Collection tabs — the stats past the
// headline tiles. Like tgAnalyticsModel, everything is computed from the
// page's own cached TgGame rows; nothing here fetches.
//
// Two honesty rules run through this file:
// - "Played" means a provider recorded play (seconds, launches or a session
//   date). ES-DE only counts games IT launched, so "no recorded play" is not
//   "never played" — the copy says "no recorded play".
// - Every list is built from the same rows as the figure beside it, so a
//   figure and its list can't disagree.

import { hasPlayData, isRealPlay } from '../../gameStats'
import {
  NO_PLATFORM, genreKey, lastPlayedIso, platformCounts, platformLabels, playCount, playSeconds, type TgGame,
} from '../testGameModel'
import { libraryOf, type TgaBarRow, type TgaLibrary } from './tgAnalyticsModel'

const at = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN)
const byTitle = (a: TgGame, b: TgGame) => a.title.localeCompare(b.title)
const DAY = 86_400_000

export const isPlayed = (g: TgGame) => hasPlayData(g)

function median(values: number[]): number | null {
  if (!values.length) return null
  const v = [...values].sort((a, b) => a - b)
  const mid = v.length >> 1
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2
}

// ─── S1 · Play coverage ──────────────────────────────────────────────────────

export interface TgaCoverageRow extends TgaBarRow {
  /** Games with recorded play (the bar's filled part, also in `part`). */
  played: number
}

export interface TgaPlayCoverage {
  total: number
  played: number
  unplayed: number
  /** Per platform, most games first; `count` is the platform's games, `played` its played share. */
  rows: TgaCoverageRow[]
}

/** How much of the library has ever recorded play, overall and per platform. */
export function playCoverage(scoped: TgGame[], max = 10): TgaPlayCoverage {
  const counts = platformCounts(scoped)
  const labels = platformLabels(counts)
  const playedBy = new Map<string, number>()
  let played = 0
  for (const g of scoped) {
    if (!isPlayed(g)) continue
    played++
    playedBy.set(g.platformKey, (playedBy.get(g.platformKey) ?? 0) + 1)
  }
  const shown = counts.length <= max + 1 ? counts : counts.slice(0, max)
  const rest = counts.slice(shown.length)
  const rows: TgaCoverageRow[] = shown.map(c => ({
    key: c.key, label: labels.get(c.key) ?? c.info.short, count: c.count, played: playedBy.get(c.key) ?? 0, target: c.key,
    part: playedBy.get(c.key) ?? 0, title: `${playedBy.get(c.key) ?? 0} of ${c.count} played`,
  }))
  if (rest.length) {
    rows.push({
      key: '__others', label: `${rest.length} more`, target: null,
      count: rest.reduce((n, c) => n + c.count, 0),
      played: rest.reduce((n, c) => n + (playedBy.get(c.key) ?? 0), 0),
      part: rest.reduce((n, c) => n + (playedBy.get(c.key) ?? 0), 0),
      title: rest.map(c => `${labels.get(c.key) ?? c.info.short} (${playedBy.get(c.key) ?? 0} of ${c.count})`).join(', '),
    })
  }
  return { total: scoped.length, played, unplayed: scoped.length - played, rows }
}

// ─── S2 · Community score ────────────────────────────────────────────────────

/**
 * The community's score, 0–100: ES-DE's scraped rating or ScreenScraper's
 * note, stored on the variant. The primary variant's, else the best of the
 * others. Null when no variant has one (Steam and PlayStation rows today).
 */
export function communityScore(g: TgGame): number | null {
  const valid = (r: number | null | undefined) => (r != null && Number.isFinite(r) && r >= 0 && r <= 100 ? r : null)
  const primary = g.platforms.find(p => p.is_primary_variant) ?? g.platforms[0]
  const own = valid(primary?.rating)
  if (own != null) return own
  let best: number | null = null
  for (const p of g.platforms) {
    const r = valid(p.rating)
    if (r != null && (best == null || r > best)) best = r
  }
  return best
}

export interface TgaScoreBucket { key: string; label: string; from: number; count: number }

/** Community scores in ten-point buckets (90–100 is one bucket), with the median. */
export function scoreSeries(scoped: TgGame[]): { buckets: TgaScoreBucket[]; scored: number; median: number | null } {
  const buckets: TgaScoreBucket[] = Array.from({ length: 10 }, (_, i) => ({
    key: String(i * 10), label: i === 9 ? '90–100' : `${i * 10}–${i * 10 + 9}`, from: i * 10, count: 0,
  }))
  const all: number[] = []
  for (const g of scoped) {
    const s = communityScore(g)
    if (s == null) continue
    all.push(s)
    buckets[Math.min(9, Math.floor(s / 10))].count++
  }
  const m = median(all)
  return { buckets, scored: all.length, median: m == null ? null : Math.round(m) }
}

// ─── S3 · Worth playing next ─────────────────────────────────────────────────

/**
 * Games with no recorded play, best community score first (ties: newer
 * first, then title). Dropped and completed games are out — those are
 * decisions already made. Only scores of at least `min` qualify.
 */
export function topUnplayedByScore(scoped: TgGame[], n = 8, min = 80): { game: TgGame; score: number }[] {
  return scoped
    .filter(g => !isPlayed(g) && g.play_status !== 'dropped' && g.play_status !== 'completed')
    .map(game => ({ game, score: communityScore(game) }))
    .filter((x): x is { game: TgGame; score: number } => x.score != null && x.score >= min)
    .sort((a, b) => b.score - a.score || (b.game.release_year ?? 0) - (a.game.release_year ?? 0) || byTitle(a.game, b.game))
    .slice(0, n)
}

// ─── S4 · Libraries compared ─────────────────────────────────────────────────

export interface TgaLibraryRow {
  library: Exclude<TgaLibrary, 'all'>
  games: number
  played: number
  seconds: number
  /** Median play time of the games with any, in seconds. */
  medianSeconds: number | null
  completed: number
  /** Null when the provider never reports launches (Steam). */
  launches: number | null
  lastSession: string | null
}

const LIBS: Exclude<TgaLibrary, 'all'>[] = ['retro', 'steam', 'playstation']

/** One row per library that has games in view. */
export function libraryComparison(scoped: TgGame[]): TgaLibraryRow[] {
  return LIBS.map(library => {
    const gs = scoped.filter(g => libraryOf(g) === library)
    const secs = gs.map(g => playSeconds(g) ?? 0).filter(s => s > 0)
    const counts = gs.map(playCount).filter((c): c is number => c != null)
    let last: string | null = null
    for (const g of gs) {
      const l = lastPlayedIso(g)
      if (l && (!last || at(l) > at(last))) last = l
    }
    return {
      library,
      games: gs.length,
      played: gs.filter(isPlayed).length,
      seconds: secs.reduce((n, s) => n + s, 0),
      medianSeconds: median(secs),
      completed: gs.filter(g => g.play_status === 'completed').length,
      launches: counts.length ? counts.reduce((n, c) => n + c, 0) : null,
      lastSession: last,
    }
  }).filter(r => r.games > 0)
}

// ─── S5 · Platforms by metric ────────────────────────────────────────────────

export type TgaPlatformMetric = 'games' | 'hours' | 'played' | 'completed'

export const TGA_PLATFORM_METRICS: { key: TgaPlatformMetric; label: string }[] = [
  { key: 'games', label: 'Games' },
  { key: 'hours', label: 'Play time' },
  { key: 'played', label: 'Played share' },
  { key: 'completed', label: 'Completed' },
]

/** A platform row for one metric — `part` and `valueLabel` as on TgaBarRow. */
export type TgaMetricRow = TgaBarRow

/**
 * Platforms ranked by one metric. `count` is the value the bar is drawn from
 * (seconds for play time); shares rank by the share but draw the platform's
 * games with the played part filled. Platforms with nothing for the metric
 * drop out of the ranking (a platform with no play time has no play-time bar).
 */
export function platformRowsBy(scoped: TgGame[], metric: TgaPlatformMetric, fmtHours: (seconds: number) => string, max = 10): TgaMetricRow[] {
  const counts = platformCounts(scoped)
  const labels = platformLabels(counts)
  const acc = new Map<string, { games: number; played: number; seconds: number; completed: number }>()
  for (const g of scoped) {
    const a = acc.get(g.platformKey) ?? { games: 0, played: 0, seconds: 0, completed: 0 }
    a.games++
    if (isPlayed(g)) a.played++
    a.seconds += playSeconds(g) ?? 0
    if (g.play_status === 'completed') a.completed++
    acc.set(g.platformKey, a)
  }
  const rows: (TgaMetricRow & { rank: number })[] = counts.map(c => {
    const a = acc.get(c.key)!
    const base = { key: c.key, label: labels.get(c.key) ?? c.info.short, target: c.key }
    switch (metric) {
      case 'games': return { ...base, count: a.games, rank: a.games }
      case 'hours': return { ...base, count: a.seconds, valueLabel: fmtHours(a.seconds), rank: a.seconds }
      case 'played': return { ...base, count: a.games, part: a.played, valueLabel: `${Math.round((a.played / a.games) * 100)}%`, title: `${a.played} of ${a.games} played`, rank: a.played / a.games }
      case 'completed': return { ...base, count: a.games, part: a.completed, valueLabel: String(a.completed), title: `${a.completed} of ${a.games} completed`, rank: a.completed }
    }
  })
  return rows
    .filter(r => (metric === 'games' ? r.count > 0 : r.rank > 0))
    .sort((a, b) => b.rank - a.rank || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, max)
    .map(r => { const { rank, ...row } = r; void rank; return row })
}

// ─── S6 · An honest "Playing now" ────────────────────────────────────────────

export interface TgaPlayingBreakdown {
  total: number
  /** Chosen by you (Playing has a start date — setPlayStatus stamps one). */
  chosen: number
  /** Set by an importer's "has real hours" promotion (no start date). */
  auto: number
  /** Playing, but no session in `staleDays` days (or none at all), longest idle first. */
  stale: { game: TgGame; last: string | null; idleDays: number | null }[]
}

export function playingBreakdown(scoped: TgGame[], today: number, staleDays = 60): TgaPlayingBreakdown {
  const playing = scoped.filter(g => g.play_status === 'playing')
  const chosen = playing.filter(g => !!g.started_at || !!g.finished_at).length
  const stale = playing
    .map(game => {
      const last = lastPlayedIso(game)
      const t = at(last)
      return { game, last, idleDays: Number.isFinite(t) ? Math.max(0, Math.floor((today - t) / DAY)) : null }
    })
    .filter(x => x.idleDays == null || x.idleDays >= staleDays)
    .sort((a, b) => (b.idleDays ?? Infinity) - (a.idleDays ?? Infinity) || byTitle(a.game, b.game))
  return { total: playing.length, chosen, auto: playing.length - chosen, stale }
}

// ─── S9 · Launches and session length ────────────────────────────────────────

/** Lifetime average per launch, in seconds; null without both a play time and launches. */
export function avgSessionSeconds(g: TgGame): number | null {
  const s = playSeconds(g)
  const c = playCount(g)
  return s && s > 0 && c && c > 0 ? s / c : null
}

/** The most-launched games (ES-DE and PlayStation report launches). */
export function mostLaunched(scoped: TgGame[], n = 8): { game: TgGame; launches: number; seconds: number | null; last: string | null }[] {
  return scoped
    .map(game => ({ game, launches: playCount(game) ?? 0, seconds: playSeconds(game), last: lastPlayedIso(game) }))
    .filter(x => x.launches > 0)
    .sort((a, b) => b.launches - a.launches || (b.seconds ?? 0) - (a.seconds ?? 0) || byTitle(a.game, b.game))
    .slice(0, n)
}

// ─── S12 · Release decades ───────────────────────────────────────────────────

export interface TgaDecadeRow { key: string; label: string; owned: number; played: number }

/** Games per release decade (oldest first), with how many of them recorded play. */
export function decadeRows(scoped: TgGame[]): { rows: TgaDecadeRow[]; undated: number } {
  const m = new Map<number, TgaDecadeRow>()
  let undated = 0
  for (const g of scoped) {
    const y = g.release_year
    if (y == null || !Number.isFinite(y) || y < 1950 || y > 2100) { undated++; continue }
    const d = Math.floor(y / 10) * 10
    const row = m.get(d) ?? { key: String(d), label: `${d}s`, owned: 0, played: 0 }
    row.owned++
    if (isPlayed(g)) row.played++
    m.set(d, row)
  }
  return { rows: [...m.entries()].sort((a, b) => a[0] - b[0]).map(e => e[1]), undated }
}

// ─── S13 · Top studios ───────────────────────────────────────────────────────

export type TgaStudioField = 'developer' | 'publisher'

/**
 * The studios with the most games, case-folded ("NINTENDO" and "Nintendo"
 * are one studio, shown by their most common spelling). A row's target is
 * that spelling, which the library's Studio filter matches case-insensitively.
 */
export function studioRows(scoped: TgGame[], field: TgaStudioField, max = 10): { rows: TgaBarRow[]; studios: number; missing: number } {
  const m = new Map<string, { count: number; names: Map<string, number> }>()
  let missing = 0
  for (const g of scoped) {
    const raw = (g[field] ?? '').trim()
    if (!raw) { missing++; continue }
    const key = genreKey(raw)
    const e = m.get(key) ?? { count: 0, names: new Map<string, number>() }
    e.count++
    e.names.set(raw, (e.names.get(raw) ?? 0) + 1)
    m.set(key, e)
  }
  const all = [...m.entries()].map(([key, e]) => {
    const name = [...e.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
    return { key, name, count: e.count }
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const shown = all.length <= max + 1 ? all : all.slice(0, max)
  const rest = all.slice(shown.length)
  const rows: TgaBarRow[] = shown.map(s => ({ key: s.key, label: s.name, count: s.count, target: s.name }))
  if (rest.length) {
    rows.push({
      key: '__others', label: `${rest.length} more`, target: null, count: rest.reduce((n, s) => n + s.count, 0),
      title: rest.slice(0, 40).map(s => `${s.name} (${s.count})`).join(', ') + (rest.length > 40 ? ', …' : ''),
    })
  }
  return { rows, studios: all.length, missing }
}

// ─── S14 · Play-time distribution and concentration ─────────────────────────

export const TGA_PLAYTIME_BUCKETS: { key: string; label: string; min: number; max: number }[] = [
  { key: 'lt1', label: 'Under 1h', min: 0, max: 3600 },
  { key: '1-5', label: '1–5h', min: 3600, max: 5 * 3600 },
  { key: '5-20', label: '5–20h', min: 5 * 3600, max: 20 * 3600 },
  { key: '20-50', label: '20–50h', min: 20 * 3600, max: 50 * 3600 },
  { key: '50+', label: '50h+', min: 50 * 3600, max: Infinity },
]

export interface TgaPlaytimeBucket { key: string; label: string; count: number; parts: Record<Exclude<TgaLibrary, 'all'>, number> }

/** Games with play time, by how much, split by library. */
export function playtimeBuckets(scoped: TgGame[]): TgaPlaytimeBucket[] {
  const out = TGA_PLAYTIME_BUCKETS.map(b => ({ key: b.key, label: b.label, count: 0, parts: { retro: 0, steam: 0, playstation: 0 } }))
  for (const g of scoped) {
    const s = playSeconds(g) ?? 0
    if (s <= 0) continue
    const i = TGA_PLAYTIME_BUCKETS.findIndex(b => s >= b.min && s < b.max)
    out[i].count++
    out[i].parts[libraryOf(g)]++
  }
  return out
}

/** "Your top 5 games are 62% of all play time." */
export function concentration(scoped: TgGame[], n = 5): { top: { game: TgGame; seconds: number }[]; topSeconds: number; totalSeconds: number; share: number } {
  const all = scoped
    .map(game => ({ game, seconds: playSeconds(game) ?? 0 }))
    .filter(x => x.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds || byTitle(a.game, b.game))
  const top = all.slice(0, n)
  const topSeconds = top.reduce((s, x) => s + x.seconds, 0)
  const totalSeconds = all.reduce((s, x) => s + x.seconds, 0)
  return { top, topSeconds, totalSeconds, share: totalSeconds ? topSeconds / totalSeconds : 0 }
}

// ─── Multiplayer and series ──────────────────────────────────────────────────

/** The most players a "players" field allows: "1-4" → 4, "2+" → 2, "1" → 1; null when unreadable. */
export function maxPlayers(s: string | null | undefined): number | null {
  const nums = String(s ?? '').match(/\d+/g)
  if (!nums) return null
  const n = Math.max(...nums.map(Number))
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null
}

export const TGA_PLAYER_ROWS = [
  { key: 'solo', label: 'Single player' },
  { key: '2', label: 'Up to 2' },
  { key: '3-4', label: '3–4 players' },
  { key: '5+', label: '5 or more' },
] as const

/** Games by how many can play; `unknown` counts the games with no readable players field. */
export function playerRows(scoped: TgGame[]): { rows: TgaBarRow[]; unknown: number } {
  const c = { solo: 0, '2': 0, '3-4': 0, '5+': 0 }
  let unknown = 0
  for (const g of scoped) {
    const n = maxPlayers(g.players)
    if (n == null) unknown++
    else if (n === 1) c.solo++
    else if (n === 2) c['2']++
    else if (n <= 4) c['3-4']++
    else c['5+']++
  }
  return { rows: TGA_PLAYER_ROWS.map(r => ({ key: r.key, label: r.label, count: c[r.key], target: null })), unknown }
}

export interface TgaSeriesRow { key: string; label: string; games: number; played: number; completed: number }

/** Series with at least `min` games, biggest first; `share` is how much of the view has a series at all. */
export function seriesRows(scoped: TgGame[], min = 2, max = 10): { rows: TgaSeriesRow[]; withSeries: number; share: number } {
  const m = new Map<string, TgaSeriesRow>()
  let withSeries = 0
  for (const g of scoped) {
    const raw = (g.series_name ?? '').trim()
    if (!raw) continue
    withSeries++
    const key = genreKey(raw)
    const row = m.get(key) ?? { key, label: raw, games: 0, played: 0, completed: 0 }
    row.games++
    if (isPlayed(g)) row.played++
    if (g.play_status === 'completed') row.completed++
    m.set(key, row)
  }
  const rows = [...m.values()].filter(r => r.games >= min)
    .sort((a, b) => b.games - a.games || a.label.localeCompare(b.label)).slice(0, max)
  return { rows, withSeries, share: scoped.length ? withSeries / scoped.length : 0 }
}

// ─── S25 · Fun facts ─────────────────────────────────────────────────────────

export interface TgaFact { key: string; label: string; value: string; game?: TgGame }

/**
 * A few facts from what is filled: the oldest game you've played, the most
 * launched, the longest average session, and the platform and genre that
 * hold the most play time. A fact with nothing behind it is left out.
 */
export function funFacts(scoped: TgGame[], fmtHours: (seconds: number) => string): TgaFact[] {
  const facts: TgaFact[] = []
  const played = scoped.filter(isPlayed)
  const oldest = played.filter(g => g.release_year != null).sort((a, b) => (a.release_year ?? 0) - (b.release_year ?? 0) || byTitle(a, b))[0]
  if (oldest) facts.push({ key: 'oldest', label: 'Oldest game played', value: `${oldest.title} (${oldest.release_year})`, game: oldest })
  const launched = mostLaunched(scoped, 1)[0]
  if (launched) facts.push({ key: 'launched', label: 'Most launched', value: `${launched.game.title} · ${launched.launches.toLocaleString('en-GB')}×`, game: launched.game })
  const longest = scoped
    .filter(g => isRealPlay(playSeconds(g)))
    .map(game => ({ game, avg: avgSessionSeconds(game) }))
    .filter((x): x is { game: TgGame; avg: number } => x.avg != null)
    .sort((a, b) => b.avg - a.avg || byTitle(a.game, b.game))[0]
  if (longest) facts.push({ key: 'session', label: 'Longest average session', value: `${longest.game.title} · ~${fmtHours(longest.avg)}`, game: longest.game })
  const byPlatform = new Map<string, number>()
  const byGenre = new Map<string, { name: string; seconds: number }>()
  for (const g of scoped) {
    const s = playSeconds(g) ?? 0
    if (s <= 0) continue
    if (g.platformKey !== NO_PLATFORM) byPlatform.set(g.platformKey, (byPlatform.get(g.platformKey) ?? 0) + s)
    for (const raw of g.genres ?? []) {
      const name = raw.trim()
      if (!name) continue
      const e = byGenre.get(genreKey(name)) ?? { name, seconds: 0 }
      e.seconds += s
      byGenre.set(genreKey(name), e)
    }
  }
  const topPlatform = [...byPlatform.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  if (topPlatform) {
    const labels = platformLabels(platformCounts(scoped))
    facts.push({ key: 'platform', label: 'Most played platform', value: `${labels.get(topPlatform[0]) ?? topPlatform[0]} · ${fmtHours(topPlatform[1])}` })
  }
  const topGenre = [...byGenre.values()].sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))[0]
  if (topGenre) facts.push({ key: 'genre', label: 'Most played genre', value: `${topGenre.name} · ${fmtHours(topGenre.seconds)}` })
  return facts
}
