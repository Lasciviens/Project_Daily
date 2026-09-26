// The exact games behind an Analytics row — what a tap hands to the Library.
// Each selector uses the same rule as the figure it opens (verified side by
// side in scripts/verify-tg-analytics.cjs), so the list always adds up to the
// number that was tapped.

import { effectiveStatus, genreKey, type TgGame } from '../testGameModel'
import { libraryOf, type TgaLibrary } from './tgAnalyticsModel'
import type { TgaStudioField } from './tgAnalyticsMore'

/** Status mix: a missing status is Backlog, as every count files it. */
export const gamesWithStatus = (scoped: readonly TgGame[], status: string) => scoped.filter(g => effectiveStatus(g) === status)

/** Top genres (case-folded, like foldGenres). */
export function gamesWithGenre(scoped: readonly TgGame[], genre: string): TgGame[] {
  const key = genreKey(genre)
  return scoped.filter(g => (g.genres ?? []).some(x => genreKey(x) === key))
}

/** Top studios: the one field the card counts, not developer-or-publisher. */
export function gamesByStudio(scoped: readonly TgGame[], field: TgaStudioField, studio: string): TgGame[] {
  const key = genreKey(studio)
  return scoped.filter(g => !!g[field]?.trim() && genreKey(g[field]!) === key)
}

/** A platform row; `completedOnly` for the Completed ranking. */
export function gamesOfPlatform(scoped: readonly TgGame[], platformKey: string, completedOnly = false): TgGame[] {
  return scoped.filter(g => g.platformKey === platformKey && (!completedOnly || g.play_status === 'completed'))
}

/** Hidden titles of a library (the rows every other figure leaves out). */
export function hiddenGames(games: readonly TgGame[], library: TgaLibrary): TgGame[] {
  return games.filter(g => g.hidden && (library === 'all' || libraryOf(g) === library))
}
