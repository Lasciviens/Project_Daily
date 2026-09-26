// Pure model for the Test-Game page (/#/test-game).
//
// Every decision the page makes about WHICH games to show, in WHAT order, on
// WHICH shelf and with WHICH picture lives here, so the components only
// render. Only type imports and import-free modules (`gameStats.ts` is one —
// the `progressAggregate.ts` convention): `scripts/verify-test-game-model.cjs`
// requires this file through sucrase without a live Supabase client.

import type { Game, PlayStatus } from '../types'
import { isRealSession, playStatsOf } from '../gameStats'
import { psnKind } from '../providerEntries'

// ─── Page state vocabulary ───────────────────────────────────────────────────

/** The sidebar's top section. `wishlist`/`completed`/`backlog` are status
 *  views across EVERY platform; `library` is scoped by the platform list. */
export type TgSection = 'library' | 'queue' | 'wishlist' | 'completed' | 'backlog' | 'analytics' | 'scrape' | 'advanced'
export type TgView = 'shelf' | 'grid' | 'list'
export type TgSort = 'title' | 'title-desc' | 'recent' | 'playtime' | 'rating' | 'year-desc' | 'year-asc' | 'added' | 'series'
export type TgStatusFilter = 'all' | PlayStatus

export const ALL_PLATFORMS = 'all'
/** The sidebar's "Others" row: every platform past the top few, as one filter. */
export const OTHER_PLATFORMS = 'others'

/** The sort a fresh page starts on; a different one is a choice, not a filter. */
export const DEFAULT_SORT: TgSort = 'recent'

export const SORT_LABEL: Record<TgSort, string> = {
  title: 'Title',
  'title-desc': 'Title (Z–A)',
  recent: 'Last played',
  playtime: 'Most played',
  rating: 'My rating',
  'year-desc': 'Newest',
  'year-asc': 'Oldest',
  added: 'Recently added',
  series: 'Series',
}

export const STATUS_SECTIONS: Partial<Record<TgSection, PlayStatus>> = {
  wishlist: 'wishlist',
  completed: 'completed',
  backlog: 'backlog',
}

/** The status tabs under the platform header, in the design's order. */
export const STATUS_TABS: TgStatusFilter[] = ['all', 'playing', 'completed', 'backlog']

/** Every value the "All Status" dropdown offers. Hidden is last and is the
 *  only way to see hidden rows — they are excluded from every other view. */
export const STATUS_FILTERS: TgStatusFilter[] = ['all', 'playing', 'completed', 'backlog', 'wishlist', 'dropped', 'hidden']

export const STATUS_TEXT: Record<TgStatusFilter, string> = {
  all: 'All', playing: 'Playing', completed: 'Completed', backlog: 'Backlog',
  wishlist: 'Wishlist', dropped: 'Dropped', hidden: 'Hidden',
}

// ─── Platforms ───────────────────────────────────────────────────────────────

export type PlatformFamily =
  | 'playstation' | 'psp' | 'gamecube' | 'switch' | 'wii' | 'ds' | 'xbox'
  | 'steam' | 'nintendo' | 'gameboy' | 'sega' | 'arcade' | 'android' | 'other'

export interface PlatformInfo {
  key: string
  /** Sidebar / chip label — "PS2". */
  short: string
  /** Header title — "PlayStation 2". */
  name: string
  family: PlatformFamily
  /** Brand accent used by the placeholder case and the wordmark. */
  brand: string
}

type PlatformSpec = Omit<PlatformInfo, 'key'>

// ES-DE folder names (the `game_platforms.system` values) plus the two
// provider libraries. Unknown keys are expected — `platformInfo` falls back.
const PLATFORMS: Record<string, PlatformSpec> = {
  ps2:          { short: 'PS2',         name: 'PlayStation 2',            family: 'playstation', brand: '#2f6bff' },
  psx:          { short: 'PS1',         name: 'PlayStation',              family: 'playstation', brand: '#9aa3b2' },
  ps3:          { short: 'PS3',         name: 'PlayStation 3',            family: 'playstation', brand: '#1f2937' },
  psp:          { short: 'PSP',         name: 'PlayStation Portable',     family: 'psp',         brand: '#64748b' },
  psvita:       { short: 'Vita',        name: 'PlayStation Vita',         family: 'psp',         brand: '#1e40af' },
  playstation:  { short: 'PlayStation', name: 'PlayStation Network',      family: 'playstation', brand: '#0070d1' },
  gc:           { short: 'GameCube',    name: 'Nintendo GameCube',        family: 'gamecube',    brand: '#6d4aff' },
  wii:          { short: 'Wii',         name: 'Nintendo Wii',             family: 'wii',         brand: '#8fa3b8' },
  wiiu:         { short: 'Wii U',       name: 'Nintendo Wii U',           family: 'wii',         brand: '#0ea5e9' },
  switch:       { short: 'Switch',      name: 'Nintendo Switch',          family: 'switch',      brand: '#e60012' },
  n3ds:         { short: '3DS',         name: 'Nintendo 3DS',             family: 'ds',          brand: '#d91e2a' },
  nds:          { short: 'DS',          name: 'Nintendo DS',              family: 'ds',          brand: '#9ca3af' },
  n64:          { short: 'N64',         name: 'Nintendo 64',              family: 'nintendo',    brand: '#16a34a' },
  snes:         { short: 'SNES',        name: 'Super Nintendo',           family: 'nintendo',    brand: '#7c3aed' },
  snesna:       { short: 'SNES',        name: 'Super Nintendo (NA)',      family: 'nintendo',    brand: '#7c3aed' },
  nes:          { short: 'NES',         name: 'Nintendo Entertainment System', family: 'nintendo', brand: '#dc2626' },
  gba:          { short: 'GBA',         name: 'Game Boy Advance',         family: 'gameboy',     brand: '#4f46e5' },
  gbc:          { short: 'GBC',         name: 'Game Boy Color',           family: 'gameboy',     brand: '#a21caf' },
  gb:           { short: 'Game Boy',    name: 'Game Boy',                 family: 'gameboy',     brand: '#65a30d' },
  genesis:      { short: 'Genesis',     name: 'Sega Genesis',             family: 'sega',        brand: '#111827' },
  megadrive:    { short: 'Mega Drive',  name: 'Sega Mega Drive',          family: 'sega',        brand: '#111827' },
  segacd:       { short: 'Sega CD',     name: 'Sega CD',                  family: 'sega',        brand: '#1d4ed8' },
  saturn:       { short: 'Saturn',      name: 'Sega Saturn',              family: 'sega',        brand: '#374151' },
  dreamcast:    { short: 'Dreamcast',   name: 'Sega Dreamcast',           family: 'sega',        brand: '#f97316' },
  xbox:         { short: 'Xbox',        name: 'Xbox',                     family: 'xbox',        brand: '#107c10' },
  xbox360:      { short: 'Xbox 360',    name: 'Xbox 360',                 family: 'xbox',        brand: '#107c10' },
  steam:        { short: 'Steam',       name: 'Steam',                    family: 'steam',       brand: '#1b2838' },
  fbneo:        { short: 'Arcade',      name: 'Arcade (FinalBurn Neo)',   family: 'arcade',      brand: '#d97706' },
  mame:         { short: 'Arcade',      name: 'Arcade (MAME)',            family: 'arcade',      brand: '#d97706' },
  androidapps:  { short: 'Android',     name: 'Android apps',             family: 'android',     brand: '#16a34a' },
  androidgames: { short: 'Android',     name: 'Android games',            family: 'android',     brand: '#16a34a' },
}

/** The key a game with no platform variant at all is filed under. */
export const NO_PLATFORM = 'unknown'

export function platformInfo(key: string | null | undefined): PlatformInfo {
  const k = (key ?? '').trim().toLowerCase()
  if (k === ALL_PLATFORMS) return { key: k, short: 'All', name: 'All Games', family: 'other', brand: '#2f6bff' }
  if (k === OTHER_PLATFORMS) return { key: k, short: 'Others', name: 'Other Platforms', family: 'other', brand: '#64748b' }
  // A game with no variant is still a game — "UNKNOWN" read like a console.
  if (!k || k === NO_PLATFORM) return { key: NO_PLATFORM, short: 'No platform', name: 'No platform', family: 'other', brand: '#64748b' }
  const spec = PLATFORMS[k]
  if (spec) return { key: k, ...spec }
  if (k.startsWith(RESERVED_PREFIX)) {
    // A retro copy filed under a reserved spelling: "Steam (ES-DE)", "ALL".
    const base = k.slice(RESERVED_PREFIX.length)
    const known = PLATFORMS[base]
    const label = known ? `${known.short} (ES-DE)` : base.toUpperCase()
    return { key: k, short: label, name: known ? `${known.name} (ES-DE)` : label, family: 'other', brand: '#64748b' }
  }
  const label = k.toUpperCase()
  return { key: k, short: label, name: label, family: 'other', brand: '#64748b' }
}

/**
 * Display labels for a list of platforms: the short name, or the full name
 * when two platforms in the list share a short one ("SNES" for snes and
 * snesna, "Arcade" for fbneo and mame, "Android" for the two Android folders).
 * One helper so the sidebar, the phone scope and the status tabs agree.
 */
export function platformLabels(counts: PlatformCount[]): Map<string, string> {
  const tally = (labels: string[]) => {
    const m = new Map<string, number>()
    for (const l of labels) m.set(l, (m.get(l) ?? 0) + 1)
    return m
  }
  const shorts = tally(counts.map(c => c.info.short))
  const picked = counts.map(c => [c.key, (shorts.get(c.info.short) ?? 0) > 1 ? c.info.name : c.info.short] as const)
  // Two platforms whose full names ALSO collide keep their key, so no two
  // rows in one list ever read the same.
  const labels = tally(picked.map(([, l]) => l))
  return new Map(picked.map(([k, l]) => [k, (labels.get(l) ?? 0) > 1 ? `${l} (${k})` : l]))
}

// ─── Free-text systems ───────────────────────────────────────────────────────

/** Lower-case, letters and digits only: "Wii U" → "wiiu", "PS-1" → "ps1". */
const normSystem = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Keys a retro system string may never resolve to (see resolveSystemKey). */
const RESERVED_KEYS: ReadonlySet<string> = new Set([ALL_PLATFORMS, OTHER_PLATFORMS, NO_PLATFORM, 'steam', 'playstation'])
export const RESERVED_PREFIX = 'sys-'

// Spellings no key, short label or full name covers. Genesis and Mega Drive
// stay two platforms on purpose: they are two ES-DE folders (NA vs PAL sets).
const EXPLICIT_ALIASES: Record<string, string> = {
  ps1: 'psx', playstation1: 'psx', psone: 'psx',
  // A retro row's "PlayStation" is the first console. The PSN library is a
  // provider (filed by `library`, never by a system string), so it is left
  // out of the alias table below entirely.
  playstation: 'psx',
  playstation2: 'ps2',
  gamecube: 'gc', ngc: 'gc',
  ds: 'nds', '3ds': 'n3ds',
  arcade: 'fbneo',
  android: 'androidgames',
}

const SYSTEM_ALIASES: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>(Object.entries(EXPLICIT_ALIASES))
  const entries = Object.entries(PLATFORMS).filter(([key]) => key !== 'playstation')
  // First writer wins: explicit aliases, then keys, then full names, then
  // short labels (the only ones two platforms share).
  for (const pick of [(k: string) => k, (_: string, s: PlatformSpec) => s.name, (_: string, s: PlatformSpec) => s.short]) {
    for (const [key, spec] of entries) {
      const a = normSystem(pick(key, spec))
      if (a && !m.has(a)) m.set(a, key)
    }
  }
  return m
})()

/**
 * The platform key for a `game_platforms.system` value. `system` is free text
 * the user can rename ("GameCube", "PS1", "Wii U"), so it is normalised and
 * resolved through every known spelling. Deliberately NOT `esde_system`: that
 * is ES-DE's folder, while `system` is what the user chose to call the copy.
 * An unknown system keeps its normalised spelling, so "PC 98" and "pc98" are
 * still one platform.
 */
export function resolveSystemKey(system: string | null | undefined): string {
  const n = normSystem(system ?? '')
  if (!n) return NO_PLATFORM
  const k = SYSTEM_ALIASES.get(n) ?? n
  // A free-text system that happens to spell a page key ("All", "Others",
  // "Unknown") or a provider library ("Steam" — ES-DE has a steam folder)
  // must not hijack that shelf; it gets a key of its own.
  return RESERVED_KEYS.has(k) ? RESERVED_PREFIX + k : k
}

// ─── Derived game rows ───────────────────────────────────────────────────────

export interface TgGame extends Game {
  /** Which platform this row is filed under — ONE per game, so counts add up. */
  platformKey: string
  /** Hidden rows are left out of every view except the "Hidden" status. */
  hidden: boolean
  /** Steam rows carry their appid in `external_ref`. */
  steamAppId: number | null
  /** A Steam row whose cached store type is known and is not "game" (a tool,
   *  a DLC, a soundtrack). Such a row is hidden while its status is undecided,
   *  so a menu must never offer it a status that would hide it again. */
  notAGame: boolean
}

/**
 * The platform a game is filed under. A retro game can have several variants
 * (a PS2 and a GameCube copy); it is counted once, under its primary variant,
 * so the sidebar counts sum to the library size.
 */
export function derivePlatformKey(g: Game): string {
  if (g.library === 'steam') return 'steam'
  if (g.library === 'playstation') return 'playstation'
  const primary = g.platforms?.find(p => p.is_primary_variant) ?? g.platforms?.[0]
  return resolveSystemKey(primary?.system)
}

export function steamAppIdOf(g: Game): number | null {
  if (g.library !== 'steam' || !g.external_ref) return null
  const n = Number(g.external_ref)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** A Steam row whose cached store type is known and is not a game. */
export function isNotAGame(g: Game, steamType: string | null | undefined): boolean {
  // PlayStation: Sony's own category, stored at import (migration 105) — an
  // app or media title is not a game. Unknown/absent stays a game.
  if (g.library === 'playstation') return psnKind(g.provider_kind) === 'not_game'
  if (g.library !== 'steam') return false
  const t = String(steamType ?? '').trim().toLowerCase()
  return !!t && t !== 'game'
}

/**
 * A status nobody chose. `backlog` is the import default, and a `playing` with
 * neither date was set by the importer's "has real hours" promotion
 * (`shouldAutoMarkPlaying`) — `setPlayStatus` stamps `started_at` whenever a
 * person picks Playing, so the missing date is what tells the two apart.
 */
export function isUndecidedStatus(g: Pick<Game, 'play_status' | 'started_at' | 'finished_at'>): boolean {
  const s = g.play_status
  return !s || s === 'backlog' || (s === 'playing' && !g.started_at && !g.finished_at)
}

/**
 * Whether a row stays out of the grid.
 *
 * An explicit `hidden` status always hides. Otherwise only a Steam row known
 * NOT to be a game hides, and only while its status is undecided (see
 * `isUndecidedStatus`). An unclassified app stays visible — hiding what has
 * merely not been looked up yet would read as the library losing data.
 *
 * Stricter than `providerEntries.isHiddenEntry` (/games), which treats every
 * status as a decision: here the importer's own writes are not evidence of
 * interest, so a Steam tool it promoted to Playing does not fill the shelf.
 */
export function isHiddenRow(g: Game, steamType: string | null | undefined): boolean {
  if (g.play_status === 'hidden') return true
  return isNotAGame(g, steamType) && isUndecidedStatus(g)
}

// Keeps each derived row's identity while its source row and classification
// are unchanged. TanStack's structural sharing keeps the objects of rows a
// refetch did not change, so a status change re-renders one memoised card
// instead of the whole library.
const derivedCache = new WeakMap<Game, TgGame>()

function deriveOne(g: Game, steamAppId: number | null, notAGame: boolean): TgGame {
  return {
    ...g,
    platforms: g.platforms ?? [],
    platformKey: derivePlatformKey(g),
    steamAppId,
    notAGame,
    hidden: g.play_status === 'hidden' || (notAGame && isUndecidedStatus(g)),
  }
}

export function deriveGames(games: Game[], steamTypes?: Map<number, string | null>): TgGame[] {
  const seen = new Set<string>()
  const out: TgGame[] = []
  for (const g of games) {
    if (!g?.id || seen.has(g.id)) continue
    seen.add(g.id)
    const steamAppId = steamAppIdOf(g)
    const notAGame = isNotAGame(g, steamAppId != null ? steamTypes?.get(steamAppId) : null)
    const hit = derivedCache.get(g)
    if (hit && hit.notAGame === notAGame) { out.push(hit); continue }
    const tg = deriveOne(g, steamAppId, notAGame)
    derivedCache.set(g, tg)
    out.push(tg)
  }
  return out
}

// ─── Counts ──────────────────────────────────────────────────────────────────

export interface PlatformCount { key: string; count: number; info: PlatformInfo }

/** Visible games per platform, biggest first (ties by name). */
export function platformCounts(games: TgGame[]): PlatformCount[] {
  const m = new Map<string, number>()
  for (const g of games) if (!g.hidden) m.set(g.platformKey, (m.get(g.platformKey) ?? 0) + 1)
  return [...m.entries()]
    .map(([key, count]) => ({ key, count, info: platformInfo(key) }))
    .sort((a, b) => b.count - a.count || a.info.name.localeCompare(b.info.name))
}

/**
 * The sidebar list: the biggest `max` platforms by name, and the rest folded
 * into one "Others" row. A single leftover platform is shown by name instead —
 * an "Others" that holds exactly one platform only hides its name.
 */
export function splitPlatforms(counts: PlatformCount[], max = 8): { shown: PlatformCount[]; others: PlatformCount[] } {
  if (counts.length <= max + 1) return { shown: counts, others: [] }
  return { shown: counts.slice(0, max), others: counts.slice(max) }
}

export type StatusCounts = Record<TgStatusFilter, number>

export function statusCounts(games: TgGame[]): StatusCounts {
  const c: StatusCounts = { all: 0, playing: 0, completed: 0, backlog: 0, wishlist: 0, dropped: 0, hidden: 0 }
  for (const g of games) {
    if (g.hidden) { c.hidden++; continue }
    c.all++
    const s = g.play_status as TgStatusFilter
    if (s in c && s !== 'all' && s !== 'hidden') c[s]++
  }
  return c
}

/** A genre's identity across sources: "Action", "action " and "ACTION" are one genre. */
export const genreKey = (s: string) => s.trim().toLocaleLowerCase('en')

/**
 * Genres folded case-insensitively, each counted once per game and shown in
 * its most common spelling. `hidden` rows count only when asked (the Hidden
 * view lists its own genres).
 */
export function foldGenres(games: readonly TgGame[], includeHidden = false): { genre: string; count: number }[] {
  return foldValues(games, g => g.genres ?? [], includeHidden).map(({ value, count }) => ({ genre: value, count }))
}

/**
 * Developer and publisher as one "studio" facet (91% filled for retro), folded
 * like genres; a game counts once per studio even when it is both.
 */
export function studioOptions(games: readonly TgGame[], includeHidden = false): { studio: string; count: number }[] {
  return foldValues(games, g => [g.developer, g.publisher].filter((x): x is string => !!x), includeHidden)
    .map(({ value, count }) => ({ studio: value, count }))
}

/** Case-insensitive value counts over a per-game list, most common spelling shown. */
function foldValues(games: readonly TgGame[], pick: (g: TgGame) => readonly string[], includeHidden: boolean): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  const spellings = new Map<string, Map<string, number>>()
  for (const g of games) {
    if (g.hidden && !includeHidden) continue
    const seen = new Set<string>()
    for (const raw of pick(g)) {
      const label = raw.trim()
      if (!label) continue
      const k = genreKey(label)
      const sp = spellings.get(k) ?? new Map<string, number>()
      sp.set(label, (sp.get(label) ?? 0) + 1)
      spellings.set(k, sp)
      if (seen.has(k)) continue
      seen.add(k)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }
  const labelOf = (k: string) => [...(spellings.get(k) ?? new Map<string, number>()).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? k
  return [...counts.entries()]
    .map(([k, count]) => ({ value: labelOf(k), count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

export function genreOptions(games: TgGame[]): { genre: string; count: number }[] {
  return foldGenres(games)
}

// ─── Filtering & sorting ─────────────────────────────────────────────────────

/** Title, series, studio, genres/modes ("tags") and the platform's names. */
export function matchesSearch(g: TgGame, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const info = platformInfo(g.platformKey)
  const hay = [
    g.title, g.series_name, g.developer, g.publisher,
    ...(g.genres ?? []), ...(g.modes ?? []),
    info.short, info.name, g.platformKey,
    ...g.platforms.map(p => p.system),
  ]
  return hay.some(v => typeof v === 'string' && v.toLowerCase().includes(q))
}

export interface FilterOptions {
  section: TgSection
  /** Library section only: a platform key, ALL_PLATFORMS or OTHER_PLATFORMS. */
  platform: string
  /** Platform keys folded into "Others" (only read when platform = OTHER_PLATFORMS). */
  otherKeys?: string[]
  /** Status sections only: narrow to one platform, or ALL_PLATFORMS. */
  scopePlatform?: string
  /** Status filter: empty = every visible game (see applyStatus). */
  statuses: readonly PlayStatus[]
  /** Studio filter (developer OR publisher): ANY picked studio; empty = all. */
  studios?: readonly string[]
  /** Genre filter: a game matches ANY picked genre; empty = every genre. */
  genres?: readonly string[]
  search: string
}

/** Everything in scope BEFORE the status filter — what the status tabs count. */
export function scopeGames(games: TgGame[], o: Omit<FilterOptions, 'statuses'>): TgGame[] {
  let gs = games
  const fixed = STATUS_SECTIONS[o.section]
  if (o.section === 'queue') {
    gs = gs.filter(g => g.play_order != null)
  } else if (fixed) {
    gs = gs.filter(g => !g.hidden && g.play_status === fixed)
    if (o.scopePlatform && o.scopePlatform !== ALL_PLATFORMS) gs = gs.filter(g => g.platformKey === o.scopePlatform)
  } else if (o.platform === OTHER_PLATFORMS) {
    const keys = new Set(o.otherKeys ?? [])
    gs = gs.filter(g => keys.has(g.platformKey))
  } else if (o.platform && o.platform !== ALL_PLATFORMS) {
    gs = gs.filter(g => g.platformKey === o.platform)
  }
  if (o.genres?.length) {
    const want = new Set(o.genres.map(genreKey))
    gs = gs.filter(g => (g.genres ?? []).some(x => want.has(genreKey(x))))
  }
  if (o.studios?.length) {
    const want = new Set(o.studios.map(genreKey))
    gs = gs.filter(g => [g.developer, g.publisher].some(x => !!x && want.has(genreKey(x))))
  }
  if (o.search.trim()) gs = gs.filter(g => matchesSearch(g, o.search))
  return gs
}

/**
 * The status filter. Takes one value ('all' = every visible game) or a set
 * picked in the multi-select filters, where an empty set also means "all".
 * Hidden rows only ever show when 'hidden' is among the picked values; a
 * picked play status never matches a hidden row (a Steam non-game still
 * holding 'backlog' belongs to Hidden, not Backlog).
 */
export function applyStatus(games: TgGame[], status: TgStatusFilter | readonly TgStatusFilter[]): TgGame[] {
  const picked = new Set<TgStatusFilter>(typeof status === 'string' ? [status] : status)
  picked.delete('all')
  if (picked.size === 0) return games.filter(g => !g.hidden)
  return games.filter(g => (g.hidden ? picked.has('hidden') : picked.has(g.play_status as TgStatusFilter)))
}

/** A multi-select filter's button text: "All Genres" / "Action" / "3 genres". */
export function multiLabel(values: readonly string[], all: string, noun: string, name: (v: string) => string = v => v): string {
  if (values.length === 0) return all
  if (values.length === 1) return name(values[0])
  return `${values.length} ${noun}`
}

/** Adds a value to a multi-select filter, or removes it when already picked. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value]
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : -Infinity
}

// Real sessions by date, then sub-five-minute launches by date, then undated
// (isRealSession — the rule Analytics' Recently played uses). A short launch is
// pushed below every real session by a fixed offset larger than any epoch-ms
// date; nothing is dropped.
const SHORT_SESSION_OFFSET = 1e14
function recentKey(g: Game): number {
  const t = time(lastPlayedIso(g))
  if (t === -Infinity) return t
  return isRealSession(playSeconds(g)) ? t : t - SHORT_SESSION_OFFSET
}

/** Sorts by a precomputed key, so a comparator never re-derives play stats. */
function sortByKey<T>(games: T[], key: (g: T) => number, dir: 1 | -1, tie: (a: T, b: T) => number): T[] {
  return games
    .map(g => ({ g, k: key(g) }))
    .sort((a, b) => (a.k === b.k ? 0 : a.k < b.k ? -dir : dir) || tie(a.g, b.g))
    .map(x => x.g)
}

export function sortGames<T extends Game>(games: T[], sort: TgSort): T[] {
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title)
  const gs = [...games]
  switch (sort) {
    case 'title-desc': return gs.sort((a, b) => byTitle(b, a))
    case 'recent':     return sortByKey(gs, recentKey, -1, byTitle)
    case 'playtime':   return sortByKey(gs, g => playSeconds(g) ?? 0, -1, byTitle)
    case 'rating':     return gs.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b))
    case 'year-desc':  return gs.sort((a, b) => (b.release_year ?? -Infinity) - (a.release_year ?? -Infinity) || byTitle(a, b))
    case 'year-asc':   return gs.sort((a, b) => (a.release_year ?? Infinity) - (b.release_year ?? Infinity) || byTitle(a, b))
    case 'added':      return gs.sort((a, b) => time(b.created_at) - time(a.created_at) || byTitle(a, b))
    // A series together in release order; games without one after, by title.
    case 'series':     return gs.sort((a, b) => {
      const sa = a.series_name?.trim() ?? '', sb = b.series_name?.trim() ?? ''
      if (!sa !== !sb) return sa ? -1 : 1
      return collator.compare(sa, sb) || (a.release_year ?? Infinity) - (b.release_year ?? Infinity) || byTitle(a, b)
    })
    default:           return gs.sort(byTitle)
  }
}

/**
 * The queue in play order, whatever sort the library uses. Two rows can share
 * a `play_order` (two quick "Add to Play Queue" taps), so ties fall back to
 * the title and then the id — every view numbers a tie the same way.
 */
export function queueOrder<T extends Game>(games: T[]): T[] {
  return games
    .filter(g => g.play_order != null)
    .sort((a, b) => (a.play_order ?? 0) - (b.play_order ?? 0)
      || collator.compare(a.title, b.title)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Each queued game's place in the Play Queue ("#3"), 1-based, counted among
 * the rows the queue actually shows: hidden games keep their `play_order`
 * (hiding does not clear it) but take no place. `play_order` itself can have
 * gaps, so its raw value would disagree with the list. The map's size is the
 * queue's length — use it for every badge.
 */
export function queueRanks(games: TgGame[]): Map<string, number> {
  const ranks = new Map<string, number>()
  queueOrder(games.filter(g => !g.hidden)).forEach((g, i) => ranks.set(g.id, i + 1))
  return ranks
}

export interface QueueInsights {
  /** Queued, visible games already Completed or Dropped — decisions that left them in the queue. */
  finished: TgGame[]
  /** Queued games still to play. */
  toPlay: number
  /** Rough play time for the rest of the queue: its length × the median play time of
   *  your completed games (null with fewer than 3 of those to go on). */
  forecastSeconds: number | null
  /** How many completed games the median came from. */
  basis: number
}

/**
 * What the Play Queue can say about itself. The forecast is deliberately
 * rough and labelled so: it knows nothing about the queued games' own length.
 */
export function queueInsights(games: readonly TgGame[]): QueueInsights {
  const queued = games.filter(g => !g.hidden && g.play_order != null)
  const finished = queued.filter(g => g.play_status === 'completed' || g.play_status === 'dropped')
  const toPlay = queued.length - finished.length
  const done = games
    .filter(g => g.play_status === 'completed')
    .map(g => playSeconds(g) ?? 0)
    .filter(s => s > 0)
    .sort((a, b) => a - b)
  const mid = done.length >> 1
  const median = done.length ? (done.length % 2 ? done[mid] : (done[mid - 1] + done[mid]) / 2) : 0
  return { finished, toPlay, forecastSeconds: done.length >= 3 && toPlay > 0 ? median * toPlay : null, basis: done.length }
}

// ─── Shelf layout ────────────────────────────────────────────────────────────

/**
 * Splits the list into `rows` shelves, each a horizontal carousel.
 *
 * Contiguous, like a real bookcase: the second shelf continues where the first
 * ended, so an A–Z list reads "A…M" then "N…Z" rather than zig-zagging. Each
 * shelf holds at least `cols` games — when everything fits on screen the rows
 * fill left to right and no carousel scrolls; only a library too big for one
 * screen spreads evenly across the shelves. Empty shelves are kept (a bookcase
 * with one short row still has its other planks).
 */
export function chunkShelves<T>(items: T[], rows: number, cols: number): T[][] {
  const r = Math.max(1, Math.floor(rows))
  const c = Math.max(1, Math.floor(cols))
  const per = Math.max(c, Math.ceil(items.length / r))
  const out: T[][] = []
  for (let i = 0; i < r; i++) out.push(items.slice(i * per, (i + 1) * per))
  return out
}

// ─── Rating ──────────────────────────────────────────────────────────────────

/**
 * `games.rating` is 0–10 (migration 089); the design shows it out of 5.
 * Exact, not rounded to a half star: a 9.5 is 4.75 stars and reads "4.75/5" —
 * rounding it to 5 would claim a rating nobody gave. Two decimals at most.
 */
export function starsFromRating(rating: number | null | undefined): number | null {
  if (rating == null) return null
  const r = Number(rating)
  if (!Number.isFinite(r)) return null
  return Math.round(Math.min(10, Math.max(0, r)) * 50) / 100
}

/** Clicks set whole or half stars, written back on the 0–10 scale. */
export function ratingFromStars(stars: number): number {
  return Math.min(10, Math.max(0, Math.round(stars * 2)))
}

/** "4.0" · "4.5" · "4.75" — whole stars keep one decimal like the design. */
export function formatStars(stars: number | null): string {
  if (stars == null || !Number.isFinite(stars)) return '—'
  const s = Math.round(stars * 100) / 100
  return Number.isInteger(s) ? s.toFixed(1) : String(s)
}

// ─── Images ──────────────────────────────────────────────────────────────────

const STEAM_CDN = 'https://cdn.akamai.steamstatic.com/steam/apps'

export const steamArt = {
  portrait: (id: number) => `${STEAM_CDN}/${id}/library_600x900.jpg`,
  hero:     (id: number) => `${STEAM_CDN}/${id}/library_hero.jpg`,
  header:   (id: number) => `${STEAM_CDN}/${id}/header.jpg`,
}

const isUrl = (u: unknown): u is string => typeof u === 'string' && /^(https?:|data:|blob:|\/)/.test(u.trim())

function uniq(urls: unknown[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const u of urls) {
    if (!isUrl(u)) continue
    const k = u.trim()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

function mediaOf(g: Game, ...types: string[]): unknown[] {
  const m = g.media
  if (!m || typeof m !== 'object') return []
  return types.map(t => (m as Record<string, unknown>)[t])
}

/** ES-DE original images by category, primary variant first. */
function esdeOf(g: Game, ...categories: string[]): string[] {
  const cats = new Set(categories)
  const platforms = [...(g.platforms ?? [])].sort((a, b) => Number(b.is_primary_variant) - Number(a.is_primary_variant))
  const out: string[] = []
  for (const p of platforms) {
    const assets = p.esde_assets
    if (!assets || typeof assets !== 'object') continue
    const entries = Object.entries(assets).sort(([a], [b]) => a.localeCompare(b))
    for (const [, a] of entries) if (a && cats.has(a.category) && isUrl(a.url)) out.push(a.url)
  }
  return out
}

// A Steam header (460×215, landscape) is a store banner, not box art: stretched
// into a portrait case it was cropped to an unreadable strip. The importer
// saves it as `primary_cover_url`, so it is matched by path, on any CDN host.
const STEAM_HEADER = /\/apps\/\d+\/header\.jpg(?:[?#]|$)/i
const isSteamHeader = (u: string) => STEAM_HEADER.test(u)

/**
 * The Steam header banner, for the case art to paint inside its front panel
 * when a Steam row has no portrait capsule. Also recognised on a non-Steam row
 * whose saved cover happens to be one.
 */
export function steamHeaderOf(g: TgGame): string | null {
  if (g.steamAppId) return steamArt.header(g.steamAppId)
  const saved = typeof g.primary_cover_url === 'string' ? g.primary_cover_url.trim() : ''
  return isUrl(saved) && isSteamHeader(saved) ? saved : null
}

const PSN_IMAGE_HOST = 'image.api.playstation.com'
const PSN_COVER_WIDTH = 440

/**
 * PlayStation's image CDN resizes on request (`?w=`), and an unsized store
 * cover is the full-resolution original — megabytes per card. The sized copy
 * goes first; the original stays right behind it for the error walk.
 */
function psnSized(u: string): string | null {
  // Cheap test first: `new URL` for every candidate of every card was a
  // measurable share of a phone grid mount.
  if (!u.includes(PSN_IMAGE_HOST)) return null
  let url: URL
  try { url = new URL(u) } catch { return null }
  if (url.hostname !== PSN_IMAGE_HOST || url.searchParams.has('w')) return null
  url.searchParams.set('w', String(PSN_COVER_WIDTH))
  return url.toString()
}

/**
 * Why a retro game belongs in "Needs review" — empty when nothing is missing.
 * Cover means any art the page can actually show (coverCandidates: ES-DE
 * covers, ScreenScraper media, variant art), not only `primary_cover_url`,
 * which flagged hundreds of games that have a cover on screen. Computed from
 * the rows the page already holds — never a second library download.
 */
export function needsReviewReasons(g: TgGame): string[] {
  if (g.library !== 'retro' || g.hidden) return []
  const r: string[] = []
  if (g.needs_review) r.push('Flagged for review')
  if (coverCandidates(g).length === 0) r.push('No cover art')
  if (!g.genres?.some(x => x.trim())) r.push('No genres')
  if (!g.release_year) r.push('No release year')
  if (g.platforms.length === 0) r.push('No platform set')
  else if (!g.platforms.some(p => p.is_primary_variant)) r.push('No primary platform chosen')
  return r
}

/** The Needs-review list in title order, each with its reasons and the cover to show. */
export function needsReviewList(games: readonly TgGame[]): { game: TgGame; reasons: string[]; cover: string | null }[] {
  return games
    .map(game => ({ game, reasons: needsReviewReasons(game) }))
    .filter(x => x.reasons.length > 0)
    .sort((a, b) => collator.compare(a.game.title, b.game.title))
    .map(x => ({ ...x, cover: coverCandidates(x.game)[0] ?? null }))
}

// Per derived row (whose identity is stable while its source row is — see
// derivedCache): cards, the hero and Needs review all ask for the same lists.
const coverMemo = new WeakMap<TgGame, string[]>()
const heroMemo = new WeakMap<TgGame, string[]>()

/** Box art, best first. The cover component walks this list on load errors. */
export function coverCandidates(g: TgGame): string[] {
  const hit = coverMemo.get(g)
  if (hit) return hit
  const list = buildCoverCandidates(g)
  coverMemo.set(g, list)
  return list
}

function buildCoverCandidates(g: TgGame): string[] {
  const primary = g.platforms.find(p => p.is_primary_variant) ?? g.platforms[0]
  const raw = uniq([
    g.steamAppId ? steamArt.portrait(g.steamAppId) : null,
    g.primary_cover_url,
    primary?.cover_url,
    primary?.box_url,
    ...mediaOf(g, 'box-2D'),
    ...esdeOf(g, 'covers'),
    ...g.platforms.flatMap(p => [p.cover_url, p.box_url]),
    ...mediaOf(g, 'box-3D'),
    ...esdeOf(g, '3dboxes'),
  ]).filter(u => !isSteamHeader(u))
  return uniq(raw.flatMap(u => [psnSized(u), u]))
}

/** Wide scene art for the detail panel's hero, best first. */
export function heroCandidates(g: TgGame): string[] {
  const hit = heroMemo.get(g)
  if (hit) return hit
  const list = buildHeroCandidates(g)
  heroMemo.set(g, list)
  return list
}

function buildHeroCandidates(g: TgGame): string[] {
  return uniq([
    g.fanart_url,
    ...mediaOf(g, 'fanart'),
    ...esdeOf(g, 'fanart'),
    g.steamAppId ? steamArt.hero(g.steamAppId) : null,
    g.screenshot_url,
    ...mediaOf(g, 'ss'),
    ...esdeOf(g, 'screenshots'),
    ...mediaOf(g, 'sstitle'),
    ...esdeOf(g, 'titlescreens'),
    g.steamAppId ? steamArt.header(g.steamAppId) : null,
  ])
}

/** Whether any in-game screenshot exists (saved, ScreenScraper or ES-DE) — Data health's coverage. */
export function hasScreenshot(g: TgGame): boolean {
  return uniq([g.screenshot_url, ...mediaOf(g, 'ss'), ...esdeOf(g, 'screenshots')]).length > 0
}

/** Whether any fan art exists (saved, ScreenScraper or ES-DE). */
export function hasFanart(g: TgGame): boolean {
  return uniq([g.fanart_url, ...mediaOf(g, 'fanart'), ...esdeOf(g, 'fanart')]).length > 0
}

/** The screenshot strip: in-game scenes, then title screens, then fanart. */
export function sceneImages(g: TgGame, extra: unknown[] = []): string[] {
  return uniq([
    g.screenshot_url,
    ...mediaOf(g, 'ss'),
    ...esdeOf(g, 'screenshots'),
    ...extra,
    ...mediaOf(g, 'sstitle'),
    ...esdeOf(g, 'titlescreens'),
    g.fanart_url,
    ...mediaOf(g, 'fanart'),
    ...esdeOf(g, 'fanart'),
  ])
}

// ─── Text ────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * en-GB day-first order, the app's date format: "15 Sep 2026".
 *
 * Built by hand rather than with `toLocaleDateString('en-GB', {month:'short'})`,
 * which current CLDR data renders as "Sept" — so the same date read "Sep" in
 * one browser and "Sept" in another, and never matched the design.
 */
export function formatDay(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** "PlayStation 2 · Action · 2005" — only the parts that exist. */
export function subtitleParts(g: TgGame, genreFallback?: string | null): string[] {
  return [
    platformInfo(g.platformKey).name,
    g.genres?.find(Boolean) ?? genreFallback ?? null,
    g.release_year ? String(g.release_year) : null,
  ].filter((x): x is string => !!x)
}

// ─── Play statistics ─────────────────────────────────────────────────────────
// One reading for the sort AND every display, shared with /games through
// `gameStats.ts::playStatsOf`. For a retro row the neutral columns are a
// one-time backfill (migration 096) that nothing updates any more — ES-DE
// keeps writing only `esde_*` — so reading them first froze play time and
// "last played" at the day 096 ran.

export function lastPlayedIso(g: Game): string | null { return playStatsOf(g).last }
export function playSeconds(g: Game): number | null { return playStatsOf(g).seconds }
export function playCount(g: Game): number | null { return playStatsOf(g).count }

// ─── Card meta & series ──────────────────────────────────────────────────────

/**
 * The one muted line a card shows under its title, following the sort (the
 * number the list is ordered by is the one worth reading): play time, last
 * session, year, date added, series — else platform · year.
 */
export function cardMeta(g: TgGame, sort: TgSort, playtime: (minutes: number) => string): string {
  const platform = platformInfo(g.platformKey).short
  switch (sort) {
    case 'playtime': { const s = playSeconds(g); return s != null && s > 0 ? playtime(s / 60) : 'No recorded play' }
    case 'recent': { const last = lastPlayedIso(g); return last ? formatDay(last) : 'No recorded play' }
    case 'year-desc':
    case 'year-asc': return g.release_year ? String(g.release_year) : 'Year unknown'
    case 'added': return `Added ${formatDay(g.created_at)}`
    case 'series': return g.series_name?.trim() || 'No series'
    default: return [platform, g.release_year].filter(Boolean).join(' · ')
  }
}

/** Other copies of the game beyond the one it is filed under ("+1"). */
export const extraVariants = (g: Pick<TgGame, 'platforms'>) => Math.max(0, (g.platforms?.length ?? 0) - 1)

/** The rest of a game's series in release order, with how many are completed. */
export function seriesSiblings(games: readonly TgGame[], g: TgGame): { series: string; games: TgGame[]; completed: number } | null {
  const series = g.series_name?.trim()
  if (!series) return null
  const key = series.toLocaleLowerCase('en')
  const all = games.filter(x => !x.hidden && x.series_name?.trim().toLocaleLowerCase('en') === key)
  if (all.length < 2) return null
  const ordered = [...all].sort((a, b) => (a.release_year ?? Infinity) - (b.release_year ?? Infinity) || collator.compare(a.title, b.title))
  return { series, games: ordered, completed: ordered.filter(x => x.play_status === 'completed').length }
}
