// Wording, shaping and layout for the Analytics Collection tab's cards (a .tsx
// file may export only components). The figures themselves come from
// tgAnalyticsMore / tgAnalyticsSeries — this file only reshapes and words them.

import { platformInfo, type TgGame } from '../testGameModel'
import type { TgaBarRow } from './tgAnalyticsModel'
import type { TgaDecadeRow, TgaPlatformMetric, TgaScoreBucket, TgaSeriesRow } from './tgAnalyticsMore'
import type { TgaColumn } from './tgAnalyticsSeries'
import { fmtInt, plural } from './tgAnalyticsFormat'

// ─── Ratings ─────────────────────────────────────────────────────────────────

export type TgaRatingsView = 'community' | 'yours'

export const TGA_RATINGS_VIEWS: { value: TgaRatingsView; label: string }[] = [
  { value: 'community', label: 'Community' },
  { value: 'yours', label: 'Yours' },
]

/** A handful of personal ratings draws no shape, so the community's scores lead until there are five. */
export const defaultRatingsView = (rated: number): TgaRatingsView => (rated < 5 ? 'community' : 'yours')

/** Community score buckets as chart columns: "0" … "80", "90+" on the axis, "Score 90–100" in the tooltip. */
export function scoreColumns(buckets: TgaScoreBucket[]): TgaColumn[] {
  return buckets.map((b, i) => ({
    key: b.key,
    tick: i === buckets.length - 1 ? `${b.from}+` : String(b.from),
    full: `Score ${b.label}`,
    count: b.count,
  }))
}

export const fmtScore = (score: number) => String(Math.round(score))

// ─── Worth playing next ──────────────────────────────────────────────────────

/** "SNES · 1995", or just the platform when the year is unknown. */
export function worthNextSubline(game: TgGame): string {
  const platform = platformInfo(game.platformKey).short
  return game.release_year ? `${platform} · ${game.release_year}` : platform
}

// ─── Platforms by metric ─────────────────────────────────────────────────────

/** The two tones a share metric's bars carry, named for the legend; null for one-tone metrics. */
export function platformLegend(metric: TgaPlatformMetric): { filled: string; rest: string } | null {
  if (metric === 'played') return { filled: 'Played', rest: 'No recorded play' }
  if (metric === 'completed') return { filled: 'Completed', rest: 'Other games' }
  return null
}

/** Why a metric has no rows. Games can't be empty: the tab only renders with games in view. */
export const TGA_PLATFORM_EMPTY: Record<TgaPlatformMetric, { title: string; hint: string }> = {
  games: { title: 'No games in view', hint: 'Pick another library or time window.' },
  hours: { title: 'No play time recorded', hint: 'ES-DE, Steam and PlayStation report lifetime hours after their next sync.' },
  played: { title: 'No recorded play', hint: 'ES-DE only counts games it launched; Steam and PlayStation count every game played.' },
  completed: { title: 'Nothing completed yet', hint: 'Mark a game Completed and its platform shows up here.' },
}

/** A row's action, for its accessible name: the completed metric lands on that platform's completed games. */
export function platformOpenLabel(metric: TgaPlatformMetric, row: TgaBarRow): string {
  return metric === 'completed' ? `Show completed ${row.label} games` : `Open the ${row.label} shelf`
}

// ─── Studios ─────────────────────────────────────────────────────────────────

export function studiosMeta(studios: number, missing: number): string {
  return `${plural(studios, 'studio')}${missing ? ` · ${fmtInt(missing)} with none recorded` : ''}`
}

// ─── Release decades ─────────────────────────────────────────────────────────

/** Two-tone decade bars: the whole bar is the decade's games, the filled part the ones with recorded play. */
export function decadeBarRows(rows: TgaDecadeRow[]): TgaBarRow[] {
  return rows.map(r => ({ key: r.key, label: r.label, count: r.owned, part: r.played, target: null, title: `${r.played} of ${r.owned} played` }))
}

export const undatedNote = (n: number) => `${plural(n, 'game')} ${n === 1 ? 'has' : 'have'} no release year`

// ─── Players ─────────────────────────────────────────────────────────────────

export const unknownPlayersNote = (n: number) => `${plural(n, 'game')} ${n === 1 ? 'doesn’t' : 'don’t'} say how many can play`

// ─── Series ──────────────────────────────────────────────────────────────────

export const seriesLine = (r: TgaSeriesRow) => `${fmtInt(r.completed)} of ${fmtInt(r.games)} completed · ${fmtInt(r.played)} played`

/** A nudge when so few games name a series that the list is mostly missing — null once 20% do. */
export function seriesShareNote(share: number): string | null {
  if (share >= 0.2) return null
  const pct = share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`
  return `Only ${pct} of games have a series recorded — ScreenScraper fills more as you scrape.`
}

// ─── Layout ──────────────────────────────────────────────────────────────────
// Spans and a visual reorder pair cards of similar height per row: the short
// cards (Ratings, Worth next, Decades, Players) together, the tall ranked
// lists (Platforms, Genres, Studios, Series) together. Screen-reader order
// stays Ratings · Worth next · Platforms · Genres · Studios · Decades ·
// Players · Series; only the visual rows move.
//                2 columns                                   3 columns                                                          4 columns
// with Series:   [Ratings · Worth] [Platforms · Genres]      [Ratings · Worth · Decades] [Platforms · Genres · Studios]         [Ratings · Worth · Decades · Players]
//                [Studios · Series] [Decades · Players]      [Players · Series ··]                                              [Platforms · Genres · Studios · Series]
// no Series:     [Ratings ··] [Worth · Platforms]            [Ratings ·· · Worth] [Platforms · Genres · Studios]                [Ratings · Worth · Decades · Players]
//                [Genres · Studios] [Decades · Players]      [Decades ·· · Players]                                             [Platforms · Genres · Studios ··]
export interface TgaCollectionLayout {
  ratings: string; worth: string; platforms: string; genres: string
  studios: string; decades: string; players: string; series: string
}

export function collectionLayout(hasSeries: boolean): TgaCollectionLayout {
  return hasSeries
    ? {
      ratings: '@[62rem]:order-1',
      worth: '@[62rem]:order-1',
      platforms: '@[62rem]:order-2',
      genres: '@[62rem]:order-2',
      studios: '@[62rem]:order-2',
      decades: '@2xl:order-1',
      players: '@2xl:order-1 @[62rem]:order-3 @[100rem]:order-1',
      series: '@[62rem]:order-3 @[62rem]:col-span-2 @[100rem]:order-2 @[100rem]:col-span-1',
    }
    : {
      ratings: '@2xl:col-span-2 @[100rem]:col-span-1 @[100rem]:order-1',
      worth: '@[100rem]:order-1',
      platforms: '@[100rem]:order-2',
      genres: '@[100rem]:order-2',
      studios: '@[100rem]:order-2 @[100rem]:col-span-2',
      decades: '@[62rem]:col-span-2 @[100rem]:col-span-1 @[100rem]:order-1',
      players: '@[100rem]:order-1',
      series: '',
    }
}
