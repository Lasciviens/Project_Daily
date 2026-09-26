// Pure numbers for the Analytics "Data health" tab: how complete the library's
// metadata is, where the artwork lives, how fresh each source is, and what is
// hidden. Computed from the cached TgGame rows the page already holds.

import { coverCandidates, hasFanart, hasScreenshot, needsReviewReasons, type TgGame } from '../testGameModel'
import { libraryOf, type TgaLibrary } from './tgAnalyticsModel'
import { communityScore } from './tgAnalyticsMore'

type Lib = Exclude<TgaLibrary, 'all'>

/** What a coverage row can hand off to: a batch scrape filter, or the Needs-review list. */
export type TgaCoverageFix = 'scrape-no-cover' | 'scrape-no-desc' | 'scrape-any' | 'review' | null

export interface TgaCoverageField {
  key: string
  label: string
  filled: number
  /** The games the field applies to (retro-only fields count retro games). */
  total: number
  fix: TgaCoverageFix
}

const has = (v: unknown) => (Array.isArray(v) ? v.some(x => String(x ?? '').trim()) : v != null && String(v).trim() !== '')
const hasAssets = (g: TgGame) => g.platforms.some(p => p.esde_assets && Object.keys(p.esde_assets).length > 0)

interface FieldDef { key: string; label: string; test: (g: TgGame) => boolean; retroOnly: boolean; fix: TgaCoverageFix }

// Retro-only: Steam and PlayStation rows carry their provider's own metadata,
// which ScreenScraper never fills — counting them would show gaps nothing can close.
const FIELDS: FieldDef[] = [
  { key: 'cover', label: 'Cover art', test: g => coverCandidates(g).length > 0, retroOnly: false, fix: 'scrape-no-cover' },
  { key: 'description', label: 'Description', test: g => has(g.description), retroOnly: true, fix: 'scrape-no-desc' },
  { key: 'genres', label: 'Genres', test: g => has(g.genres), retroOnly: true, fix: 'scrape-any' },
  { key: 'year', label: 'Release year', test: g => g.release_year != null, retroOnly: true, fix: 'scrape-any' },
  { key: 'developer', label: 'Developer', test: g => has(g.developer), retroOnly: true, fix: 'scrape-any' },
  { key: 'publisher', label: 'Publisher', test: g => has(g.publisher), retroOnly: true, fix: 'scrape-any' },
  { key: 'players', label: 'Players', test: g => has(g.players), retroOnly: true, fix: 'scrape-any' },
  { key: 'score', label: 'Community score', test: g => communityScore(g) != null, retroOnly: true, fix: 'scrape-any' },
  { key: 'screenshot', label: 'Screenshot', test: hasScreenshot, retroOnly: true, fix: 'scrape-any' },
  { key: 'fanart', label: 'Fan art', test: hasFanart, retroOnly: true, fix: 'scrape-any' },
  { key: 'series', label: 'Series', test: g => has(g.series_name), retroOnly: true, fix: 'scrape-any' },
  { key: 'esde', label: 'ES-DE original images', test: hasAssets, retroOnly: true, fix: null },
  { key: 'ss', label: 'Matched on ScreenScraper', test: g => has(g.ss_jeu_id), retroOnly: true, fix: 'scrape-any' },
]

/**
 * How complete each field is, lowest share first — the gaps worth closing
 * come first. A field with no games it applies to is left out.
 */
export function coverage(scoped: TgGame[]): { fields: TgaCoverageField[]; retro: number } {
  const retro = scoped.filter(g => libraryOf(g) === 'retro')
  const fields = FIELDS.map(f => {
    const pool = f.retroOnly ? retro : scoped
    return { key: f.key, label: f.label, filled: pool.filter(f.test).length, total: pool.length, fix: f.fix }
  }).filter(f => f.total > 0)
  fields.sort((a, b) => a.filled / a.total - b.filled / b.total || a.label.localeCompare(b.label))
  return { fields, retro: retro.length }
}

/** How many games need review, and for which reasons (a game can have several). */
export function reviewReasonCounts(scoped: TgGame[]): { games: number; reasons: { reason: string; count: number }[] } {
  const m = new Map<string, number>()
  let games = 0
  for (const g of scoped) {
    const r = needsReviewReasons(g)
    if (!r.length) continue
    games++
    for (const x of r) m.set(x, (m.get(x) ?? 0) + 1)
  }
  return { games, reasons: [...m.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)) }
}

export interface TgaFreshness {
  library: Lib
  games: number
  /** The newest sync stamp of any game in the library (ES-DE, Steam or PlayStation import). */
  lastSync: string | null
  /** Calendar days since then (yesterday at 23:00 is 1, not 0); null without a stamp. */
  days: number | null
  /** Older than `staleDays`. */
  stale: boolean
}

const localMidnight = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime() }

/** Calendar days from `t` to `today` (local midnight); rounded so a 23- or 25-hour DST day still counts as one. */
export function calendarDaysSince(t: number, today: number): number {
  return t >= today ? 0 : Math.max(1, Math.round((today - localMidnight(t)) / 86_400_000))
}

/**
 * A source's own sync stamp. A ScreenScraper save used to stamp `synced_at`
 * too (with the same instant as `ss_scraped_at`), which made the handheld look
 * freshly synced; such a stamp is not the source's.
 */
function sourceStamp(g: TgGame): string | null {
  if (!g.synced_at) return null
  return g.ss_scraped_at && g.ss_scraped_at === g.synced_at ? null : g.synced_at
}

/** When each library last heard from its source. */
export function freshness(games: TgGame[], today: number, staleDays = 7): TgaFreshness[] {
  const libs: Lib[] = ['retro', 'steam', 'playstation']
  return libs.map(library => {
    const gs = games.filter(g => libraryOf(g) === library)
    let last: string | null = null
    let lastT = -Infinity
    for (const g of gs) {
      const stamp = sourceStamp(g)
      const t = stamp ? Date.parse(stamp) : NaN
      if (Number.isFinite(t) && t > lastT) { lastT = t; last = stamp }
    }
    const days = last ? calendarDaysSince(lastT, today) : null
    return { library, games: gs.length, lastSync: last, days, stale: days == null ? gs.length > 0 : days > staleDays }
  }).filter(f => f.games > 0)
}

export interface TgaAssetCategory { category: string; images: number; bytes: number; games: number }

/**
 * The ES-DE original images the handheld uploaded (migration 100), per
 * category: how many, how big, on how many games. Counted from the rows the
 * page holds — a client-side tally, not a storage bill.
 */
export function assetInventory(scoped: TgGame[]): { categories: TgaAssetCategory[]; images: number; bytes: number; games: number; mirrored: number } {
  const m = new Map<string, { images: number; bytes: number; games: Set<string> }>()
  const withAny = new Set<string>()
  let mirrored = 0
  for (const g of scoped) {
    if (g.media && Object.keys(g.media).length > 0) mirrored++
    for (const p of g.platforms) {
      for (const a of Object.values(p.esde_assets ?? {})) {
        const cat = (a?.category ?? 'other').trim() || 'other'
        const e = m.get(cat) ?? { images: 0, bytes: 0, games: new Set<string>() }
        e.images++
        e.bytes += Number.isFinite(a?.size) ? Number(a.size) : 0
        e.games.add(g.id)
        m.set(cat, e)
        withAny.add(g.id)
      }
    }
  }
  const categories = [...m.entries()]
    .map(([category, e]) => ({ category, images: e.images, bytes: e.bytes, games: e.games.size }))
    .sort((a, b) => b.bytes - a.bytes || b.images - a.images || a.category.localeCompare(b.category))
  return {
    categories,
    images: categories.reduce((n, c) => n + c.images, 0),
    bytes: categories.reduce((n, c) => n + c.bytes, 0),
    games: withAny.size,
    mirrored,
  }
}

/** Hidden titles per library (explicitly hidden, or a Steam/PlayStation non-game nobody decided on). */
export function hiddenCounts(games: TgGame[], library: TgaLibrary): { total: number; explicit: number; auto: number } {
  let explicit = 0, auto = 0
  for (const g of games) {
    if (!g.hidden || (library !== 'all' && libraryOf(g) !== library)) continue
    if (g.play_status === 'hidden') explicit++
    else auto++
  }
  return { total: explicit + auto, explicit, auto }
}
