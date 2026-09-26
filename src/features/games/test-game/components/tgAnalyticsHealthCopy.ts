// Wording for the Analytics "Data health" cards (a .tsx file may export only
// components). The figures come from tgAnalyticsHealth — this file only puts
// them into words and decides what a row hands off to. Type imports and the
// import-free tgAnalyticsFormat only, so scripts/verify-tg-analytics-health.cjs
// can load it as is.

import type { ScrapeBatchState } from '../testGameStore'
import { calendarDaysSince, type TgaCoverageField, type TgaCoverageFix, type TgaFreshness } from './tgAnalyticsHealth'
import { fmtInt, fmtPct, plural } from './tgAnalyticsFormat'

type Lib = TgaFreshness['library']

// ─── Metadata coverage ───────────────────────────────────────────────────────

/** A share that never claims 100% while a game is still missing the field, nor 0% once one has it. */
export const coveragePct = (filled: number, total: number): string => fmtPct(filled, total)

export type TgaFixAction =
  | { kind: 'scrape'; filter: ScrapeBatchState['filter']; short: string; name: string }
  | { kind: 'review'; short: string; name: string }

// The batch filters: 'no_cover' lists retro games with no picture at all (the
// same rule as the Cover art row),
// 'no_desc' those without a description, 'todo' those never matched on
// ScreenScraper — so a gap in an already-matched game isn't in that list.
const FIX: Record<Exclude<TgaCoverageFix, null>, TgaFixAction> = {
  'scrape-no-cover': { kind: 'scrape', filter: 'no_cover', short: 'Scrape', name: 'Find missing retro covers with ScreenScraper' },
  'scrape-no-desc': { kind: 'scrape', filter: 'no_desc', short: 'Scrape', name: 'Fill missing descriptions with ScreenScraper' },
  'scrape-any': { kind: 'scrape', filter: 'todo', short: 'Scrape', name: 'Scrape the retro games not matched on ScreenScraper yet' },
  review: { kind: 'review', short: 'Review', name: 'Open Needs review' },
}

/**
 * What a coverage row offers: nothing once every game has the field, nothing
 * for a field no tool fills, and no ScreenScraper hand-off without retro
 * games (the batch only ever lists retro games).
 */
export function coverageFix(field: TgaCoverageField, retro: number): TgaFixAction | null {
  if (field.filled >= field.total || !field.fix) return null
  const fix = FIX[field.fix]
  return fix.kind === 'scrape' && retro === 0 ? null : fix
}

export function coverageMeta(retro: number): string | undefined {
  return retro > 0 ? `retro fields over ${plural(retro, 'retro game')}` : undefined
}

/** Why Cover art's total differs from the other rows' — or why it is the only row. */
export function coverageScopeNote(fields: TgaCoverageField[], retro: number): string | null {
  if (retro === 0) return 'Only cover art applies here — Steam and PlayStation bring their own metadata, which ScreenScraper doesn’t fill.'
  const cover = fields.find(f => f.key === 'cover')
  if (cover && cover.total !== retro) return 'Cover art counts every game; the other fields count retro games only — Steam and PlayStation bring their own metadata.'
  return null
}

/** A gap nothing on this page can close says where it is closed instead. */
export function coverageFootnote(fields: TgaCoverageField[]): string | null {
  const esde = fields.find(f => f.key === 'esde')
  return esde && esde.filled < esde.total ? 'ES-DE original images come from the handheld — run the Termux widget to upload them.' : null
}

// ─── Needs review ────────────────────────────────────────────────────────────

export const reviewHeadline = (games: number) => (games === 1 ? 'game needs a look' : 'games need a look')

/** Only when the rows add up to more than the games: a game can have several reasons. */
export function reviewOverlap(review: { games: number; reasons: { count: number }[] }): string | null {
  const sum = review.reasons.reduce((n, r) => n + r.count, 0)
  return sum > review.games ? 'A game can have more than one reason, so the rows add up to more than the total.' : null
}

export const REVIEW_EMPTY_HINT = 'Needs review checks retro games for a missing cover, genres, release year or platform, and anything you flagged.'

// ─── ES-DE original images ───────────────────────────────────────────────────

const ASSET_LABEL: Record<string, string> = {
  covers: 'Covers', '3dboxes': '3D boxes', backcovers: 'Back covers', screenshots: 'Screenshots',
  titlescreens: 'Title screens', fanart: 'Fan art', marquees: 'Marquees', miximages: 'Mix images',
  physicalmedia: 'Physical media', other: 'Other',
}

/** ES-DE's folder name made readable; an unknown one keeps its own words. */
export function assetCategoryLabel(category: string): string {
  const key = category.trim().toLowerCase()
  if (ASSET_LABEL[key]) return ASSET_LABEL[key]
  const words = key.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1) : 'Other'
}

/** "images · 5.2 GB on 944 games", after the big count; the size is left out when none is recorded. */
export function assetHeadline(a: { images: number; bytes: number; games: number }, fmtBytes: (n: number) => string): string {
  const size = a.bytes > 0 ? ` · ${fmtBytes(a.bytes)}` : ''
  return `${a.images === 1 ? 'image' : 'images'}${size} on ${plural(a.games, 'game')}`
}

export const mirroredLine = (n: number) => `${plural(n, 'game')} also ${n === 1 ? 'has' : 'have'} ScreenScraper artwork mirrored.`

// ─── Sources ─────────────────────────────────────────────────────────────────

export const SOURCE_META: Record<Lib, { name: string; color: string }> = {
  retro: { name: 'Retro · ES-DE', color: 'var(--tg-lib-retro)' },
  steam: { name: 'Steam', color: 'var(--tg-lib-steam)' },
  playstation: { name: 'PlayStation', color: 'var(--tg-lib-playstation)' },
}

/** Calendar days from the sync to `today` (local midnight): 0 today, 1 yesterday — the same count as the stale flag. */
export function syncDaysAgo(lastSync: string | null, today: number): number | null {
  const t = lastSync ? Date.parse(lastSync) : NaN
  return Number.isFinite(t) ? calendarDaysSince(t, today) : null
}

export function syncAgo(lastSync: string | null, today: number): string {
  const d = syncDaysAgo(lastSync, today)
  if (d == null) return 'No sync recorded'
  if (d === 0) return 'Last sync today'
  if (d === 1) return 'Last sync yesterday'
  if (d < 60) return `Last sync ${fmtInt(d)} days ago`
  if (d < 730) return `Last sync ${fmtInt(Math.floor(d / 30))} months ago`
  return `Last sync over ${fmtInt(Math.floor(d / 365))} years ago`
}

export type TgaSourceTone = 'ok' | 'warn' | 'bad'

/** The model decides what is stale (older than a week); no stamp at all, or over a month, reads as red. */
export function sourceTone(row: Pick<TgaFreshness, 'stale' | 'lastSync' | 'days'>): TgaSourceTone {
  if (!row.stale) return 'ok'
  return row.lastSync == null || (row.days ?? 0) > 30 ? 'bad' : 'warn'
}

/** How a stale source catches up: the handheld pushes ES-DE; Steam and PlayStation sync from their shelf. */
export function sourceFix(library: Lib): { kind: 'hint'; text: string } | { kind: 'shelf'; label: string; name: string } {
  if (library === 'retro') return { kind: 'hint', text: 'Run the ES-DE sync on the handheld.' }
  return { kind: 'shelf', label: 'Sync from the shelf', name: `Open the ${SOURCE_META[library].name} shelf to sync it` }
}

// ─── Hidden titles ───────────────────────────────────────────────────────────

export const HIDDEN_AUTO_NOTE = 'Steam tools, DLC and PlayStation apps you haven’t given a status stay hidden until you pick one.'
export const HIDDEN_EMPTY_HINT = 'Every title counts in these figures. “Hide game” in a game’s menu leaves one out.'
