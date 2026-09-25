// Pure model for the Test-Game page (/#/test-game).
//
// Every decision the page makes about WHICH games to show, in WHAT order, on
// WHICH shelf and with WHICH picture lives here, so the components only
// render. Type-only imports on purpose (the `progressAggregate.ts`
// convention): `scripts/verify-test-game-model.cjs` requires this file through
// sucrase without a live Supabase client.

import type { Game, PlayStatus } from '../types'

// ─── Page state vocabulary ───────────────────────────────────────────────────

/** The sidebar's top section. `wishlist`/`completed`/`backlog` are status
 *  views across EVERY platform; `library` is scoped by the platform list. */
export type TgSection = 'library' | 'queue' | 'wishlist' | 'completed' | 'backlog' | 'analytics' | 'advanced'
export type TgView = 'shelf' | 'grid' | 'list'
export type TgSort = 'title' | 'title-desc' | 'recent' | 'playtime' | 'rating' | 'year-desc' | 'year-asc' | 'added'
export type TgStatusFilter = 'all' | PlayStatus

export const ALL_PLATFORMS = 'all'
/** The sidebar's "Others" row: every platform past the top few, as one filter. */
export const OTHER_PLATFORMS = 'others'

export const SORT_LABEL: Record<TgSort, string> = {
  title: 'Title',
  'title-desc': 'Title (Z–A)',
  recent: 'Last played',
  playtime: 'Most played',
  rating: 'My rating',
  'year-desc': 'Newest',
  'year-asc': 'Oldest',
  added: 'Recently added',
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

export function platformInfo(key: string | null | undefined): PlatformInfo {
  const k = (key ?? '').trim().toLowerCase()
  if (k === ALL_PLATFORMS) return { key: k, short: 'All', name: 'All Games', family: 'other', brand: '#2f6bff' }
  if (k === OTHER_PLATFORMS) return { key: k, short: 'Others', name: 'Other Platforms', family: 'other', brand: '#64748b' }
  const spec = PLATFORMS[k]
  if (spec) return { key: k, ...spec }
  const label = k ? k.toUpperCase() : 'Unknown'
  return { key: k || 'unknown', short: label, name: label, family: 'other', brand: '#64748b' }
}

// ─── Derived game rows ───────────────────────────────────────────────────────

export interface TgGame extends Game {
  /** Which platform this row is filed under — ONE per game, so counts add up. */
  platformKey: string
  /** Hidden rows are left out of every view except the "Hidden" status. */
  hidden: boolean
  /** Steam rows carry their appid in `external_ref`. */
  steamAppId: number | null
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
  const sys = primary?.system?.trim().toLowerCase()
  return sys || 'unknown'
}

export function steamAppIdOf(g: Game): number | null {
  if (g.library !== 'steam' || !g.external_ref) return null
  const n = Number(g.external_ref)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * Whether a row stays out of the grid.
 *
 * Mirrors `providerEntries.isHiddenEntry` (kept import-free here): an explicit
 * `hidden` status always hides, any other explicit status always shows, and
 * only a Steam row whose cached store type is known NOT to be a game hides
 * automatically. An unclassified app stays visible — hiding what has merely
 * not been looked up yet would read as the library losing data.
 */
export function isHiddenRow(g: Game, steamType: string | null | undefined): boolean {
  if (g.play_status === 'hidden') return true
  if (g.library !== 'steam') return false
  const t = String(steamType ?? '').trim().toLowerCase()
  if (!t || t === 'game') return false
  // A deliberately tracked app (playing/completed/…) stays; `backlog` is the
  // import default, so it is not evidence of interest.
  return g.play_status === 'backlog' || !g.play_status
}

export function deriveGames(games: Game[], steamTypes?: Map<number, string | null>): TgGame[] {
  const seen = new Set<string>()
  const out: TgGame[] = []
  for (const g of games) {
    if (!g?.id || seen.has(g.id)) continue
    seen.add(g.id)
    const steamAppId = steamAppIdOf(g)
    out.push({
      ...g,
      platforms: g.platforms ?? [],
      platformKey: derivePlatformKey(g),
      steamAppId,
      hidden: isHiddenRow(g, steamAppId != null ? steamTypes?.get(steamAppId) : null),
    })
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

export function genreOptions(games: TgGame[]): { genre: string; count: number }[] {
  const m = new Map<string, number>()
  for (const g of games) {
    if (g.hidden) continue
    for (const x of new Set((g.genres ?? []).map(s => s.trim()).filter(Boolean))) m.set(x, (m.get(x) ?? 0) + 1)
  }
  return [...m.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count || a.genre.localeCompare(b.genre))
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
  status: TgStatusFilter
  genre: string | null
  search: string
}

/** Everything in scope BEFORE the status filter — what the status tabs count. */
export function scopeGames(games: TgGame[], o: Omit<FilterOptions, 'status'>): TgGame[] {
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
  if (o.genre) gs = gs.filter(g => (g.genres ?? []).some(x => x.trim() === o.genre))
  if (o.search.trim()) gs = gs.filter(g => matchesSearch(g, o.search))
  return gs
}

export function applyStatus(games: TgGame[], status: TgStatusFilter): TgGame[] {
  if (status === 'hidden') return games.filter(g => g.hidden)
  const visible = games.filter(g => !g.hidden)
  return status === 'all' ? visible : visible.filter(g => g.play_status === status)
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? t : -Infinity
}
const lastPlayedOf = (g: Game) => g.last_played_at ?? g.esde_last_played ?? null
const playSecondsOf = (g: Game) => g.play_seconds ?? g.esde_playtime_seconds ?? 0

export function sortGames<T extends Game>(games: T[], sort: TgSort): T[] {
  const byTitle = (a: T, b: T) => collator.compare(a.title, b.title)
  const gs = [...games]
  switch (sort) {
    case 'title-desc': return gs.sort((a, b) => byTitle(b, a))
    case 'recent':     return gs.sort((a, b) => time(lastPlayedOf(b)) - time(lastPlayedOf(a)) || byTitle(a, b))
    case 'playtime':   return gs.sort((a, b) => playSecondsOf(b) - playSecondsOf(a) || byTitle(a, b))
    case 'rating':     return gs.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || byTitle(a, b))
    case 'year-desc':  return gs.sort((a, b) => (b.release_year ?? -Infinity) - (a.release_year ?? -Infinity) || byTitle(a, b))
    case 'year-asc':   return gs.sort((a, b) => (a.release_year ?? Infinity) - (b.release_year ?? Infinity) || byTitle(a, b))
    case 'added':      return gs.sort((a, b) => time(b.created_at) - time(a.created_at) || byTitle(a, b))
    default:           return gs.sort(byTitle)
  }
}

/** The queue in play order, whatever sort the library uses. */
export function queueOrder<T extends Game>(games: T[]): T[] {
  return games.filter(g => g.play_order != null).sort((a, b) => (a.play_order ?? 0) - (b.play_order ?? 0))
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

/** `games.rating` is 0–10 (migration 089); the design shows it out of 5. */
export function starsFromRating(rating: number | null | undefined): number | null {
  if (rating == null || !Number.isFinite(Number(rating))) return null
  return Math.round(Math.min(10, Math.max(0, Number(rating)))) / 2
}

export function ratingFromStars(stars: number): number {
  return Math.min(10, Math.max(0, Math.round(stars * 2)))
}

export function formatStars(stars: number | null): string {
  if (stars == null) return '—'
  return Number.isInteger(stars) ? `${stars}.0` : String(stars)
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

/** Box art, best first. The cover component walks this list on load errors. */
export function coverCandidates(g: TgGame): string[] {
  const primary = g.platforms.find(p => p.is_primary_variant) ?? g.platforms[0]
  return uniq([
    g.steamAppId ? steamArt.portrait(g.steamAppId) : null,
    g.primary_cover_url,
    primary?.cover_url,
    primary?.box_url,
    ...mediaOf(g, 'box-2D'),
    ...esdeOf(g, 'covers'),
    ...g.platforms.flatMap(p => [p.cover_url, p.box_url]),
    ...mediaOf(g, 'box-3D'),
    ...esdeOf(g, '3dboxes'),
  ])
}

/** Wide scene art for the detail panel's hero, best first. */
export function heroCandidates(g: TgGame): string[] {
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

export function lastPlayedIso(g: Game): string | null { return lastPlayedOf(g) }
export function playSeconds(g: Game): number | null { return g.play_seconds ?? g.esde_playtime_seconds ?? null }
