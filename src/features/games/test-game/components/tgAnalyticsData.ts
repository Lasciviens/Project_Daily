import { useMemo } from 'react'
import type { TgGame } from '../testGameModel'
import {
  computeKpis, genreRows, libraryGames, libraryOf, mostPlayed, platformRows, recentlyPlayed,
  scopeByWindow, statusMix, windowStart, type TgaLibrary, type TgaWindow,
} from './tgAnalyticsModel'
import { completionSeries, ratingSeries } from './tgAnalyticsSeries'

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

/**
 * Every figure on the Analytics screen for one window and library, in one
 * pass over the cached rows. Recomputed only when the rows, the filters or
 * the day change — a status edit elsewhere re-derives it once.
 */
export function useTgAnalyticsData(games: TgGame[], period: TgaWindow, library: TgaLibrary, today: number) {
  return useMemo(() => {
    const start = windowStart(period, today)
    const inLibrary = libraryGames(games, library)
    const scoped = scopeByWindow(inLibrary, start)
    const platforms = platformRows(scoped)
    const genres = genreRows(scoped)
    return {
      start,
      scoped,
      kpis: computeKpis(scoped, start),
      mix: statusMix(scoped),
      platforms: platforms.rows,
      platformCount: platforms.counts.length,
      genres,
      mostPlayed: mostPlayed(scoped),
      recent: recentlyPlayed(scoped),
      // The timeline reads the whole library's finish dates and plots only the window's range.
      completions: completionSeries(inLibrary, period, today),
      ratings: ratingSeries(scoped),
    }
  }, [games, period, library, today])
}
