import { useMemo } from 'react'
import { formatPlaytime } from '../../api/playtimeFormat'
import type { TgGame } from '../testGameModel'
import {
  computeKpis, genreRows, libraryGames, libraryOf, mostPlayed, platformRows, recentlyPlayed,
  scopeByWindow, statusMix, windowEnd, windowStart, type TgaLibrary, type TgaWindow,
} from './tgAnalyticsModel'
import { activitySeries, ratingSeries } from './tgAnalyticsSeries'
import {
  concentration, decadeRows, funFacts, libraryComparison, mostLaunched, playCoverage, playerRows,
  playingBreakdown, playtimeBuckets, scoreSeries, seriesRows, studioRows, topUnplayedByScore,
} from './tgAnalyticsMore'
import { assetInventory, coverage, freshness, hiddenCounts, reviewReasonCounts } from './tgAnalyticsHealth'

/** Play time for a bar label or a fact: "12h 30m". */
export const fmtHours = (seconds: number) => formatPlaytime(seconds / 60)

/** Visible games per library, for the library filter's counts. */
export function useLibraryCounts(games: TgGame[]): Record<TgaLibrary, number> {
  return useMemo(() => {
    const c: Record<TgaLibrary, number> = { all: 0, retro: 0, steam: 0, playstation: 0 }
    for (const g of games) {
      if (g.hidden) continue
      c.all++
      c[libraryOf(g)]++
    }
    return c
  }, [games])
}

/** What every tab shares: the window's bounds, the library's games and the games the window selects. */
export interface TgaBase {
  games: TgGame[]
  period: TgaWindow
  library: TgaLibrary
  today: number
  start: number | null
  end: number
  /** Visible games of the library, before the time window. */
  inLibrary: TgGame[]
  /** The games the window selects — what every card describes. */
  scoped: TgGame[]
}

export function useTgAnalyticsBase(games: TgGame[], period: TgaWindow, library: TgaLibrary, today: number): TgaBase {
  return useMemo(() => {
    const start = windowStart(period, today)
    const end = windowEnd(today)
    const inLibrary = libraryGames(games, library)
    return { games, period, library, today, start, end, inLibrary, scoped: scopeByWindow(inLibrary, start, end) }
  }, [games, period, library, today])
}

// Each tab derives only its own figures, and only while it is open: the tab
// components call these hooks, so a closed tab costs nothing.

export function useOverviewData(b: TgaBase) {
  return useMemo(() => ({
    kpis: computeKpis(b.scoped, b.start, b.end, b.today),
    mix: statusMix(b.scoped),
    // The timeline reads the whole library's dates and plots only the window's range.
    activity: activitySeries(b.inLibrary, b.period, b.today),
    playing: playingBreakdown(b.scoped, b.today),
    recent: recentlyPlayed(b.scoped),
    facts: funFacts(b.scoped, fmtHours),
    hidden: hiddenCounts(b.games, b.library),
  }), [b])
}

export function usePlayData(b: TgaBase) {
  return useMemo(() => ({
    coverage: playCoverage(b.scoped),
    // Comparing libraries only means something when more than one is in view.
    libraries: b.library === 'all' ? libraryComparison(b.scoped) : [],
    mostPlayed: mostPlayed(b.scoped),
    mostLaunched: mostLaunched(b.scoped),
    buckets: playtimeBuckets(b.scoped),
    concentration: concentration(b.scoped),
  }), [b])
}

export function useCollectionData(b: TgaBase) {
  return useMemo(() => {
    const platforms = platformRows(b.scoped)
    return {
      ratings: ratingSeries(b.scoped),
      scores: scoreSeries(b.scoped),
      // "Worth playing next" is about the library, not a period: it reads every game in it.
      worthNext: topUnplayedByScore(b.inLibrary),
      platformCount: platforms.counts.length,
      genres: genreRows(b.scoped),
      developers: studioRows(b.scoped, 'developer'),
      publishers: studioRows(b.scoped, 'publisher'),
      decades: decadeRows(b.scoped),
      players: playerRows(b.scoped),
      series: seriesRows(b.scoped),
    }
  }, [b])
}

/** Data health describes the library as it is, so it ignores the time window. */
export function useHealthData(b: TgaBase) {
  return useMemo(() => ({
    coverage: coverage(b.inLibrary),
    review: reviewReasonCounts(b.inLibrary),
    assets: assetInventory(b.inLibrary),
    // Freshness is about the sources, so it reads the whole library, hidden rows included.
    freshness: freshness(b.games, b.today),
    hidden: hiddenCounts(b.games, b.library),
  }), [b])
}
