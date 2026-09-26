import { useDeferredValue, useMemo } from 'react'
import { useTestGameStore } from './testGameStore'
import {
  ALL_PLATFORMS, OTHER_PLATFORMS, STATUS_SECTIONS,
  applyStatus, effectiveStatus, foldGenres, needsReviewReasons, platformCounts, studioOptions, queueOrder, queueRanks,
  scopeGames, sortGames, splitPlatforms, statusCounts,
  type PlatformCount, type StatusCounts, type TgGame,
} from './testGameModel'
import type { TestGameLibrary } from './useTestGameLibrary'

// What the page shows, derived from the library and the page state: which
// platform shelf, which games in which order, and every count the sidebar,
// tabs and badges print. The shell only renders it.

export interface TgLibraryView {
  counts: PlatformCount[]
  /** The sidebar's platform rows, and the ones folded into "Others". */
  shown: PlatformCount[]
  others: PlatformCount[]
  /** The Library's platform after the stale-platform fallback. */
  effectivePlatform: string
  /** A status section's platform scope after the same fallback. */
  effectiveScopePlatform: string
  /** Library, queue and the three status sections (not Analytics / Advanced). */
  isGameSection: boolean
  genres: { genre: string; count: number }[]
  /** Developer/publisher options for the Studio filter. */
  studios: { studio: string; count: number }[]
  statusCounts: StatusCounts
  /** Games on the shelf before search and filters narrow it. */
  shelfTotal: number
  /** The current section's games in display order (Advanced: the Random pool). */
  visible: TgGame[]
  /** ONE queue numbering for the badges, the queue rows and the ⋯ menu. */
  ranks: Map<string, number>
  navCounts: { queue: number; wishlist: number; completed: number; backlog: number; review: number }
}

export function useTgLibraryView(lib: TestGameLibrary): TgLibraryView {
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const scopePlatform = useTestGameStore(s => s.scopePlatform)
  // Deferred: typing and chip taps stay instant while the (interruptible)
  // filter-sort-render of ~1,000 games catches up a frame later.
  const statuses = useDeferredValue(useTestGameStore(s => s.statuses))
  const genres = useDeferredValue(useTestGameStore(s => s.genres))
  const studios = useDeferredValue(useTestGameStore(s => s.studios))
  const sort = useTestGameStore(s => s.sort)
  const search = useDeferredValue(useTestGameStore(s => s.search))
  const libraryScope = useTestGameStore(s => s.libraryScope)
  const ids = useMemo(() => (libraryScope ? new Set(libraryScope.ids) : null), [libraryScope])

  const counts = useMemo(() => platformCounts(lib.games), [lib.games])
  const { shown, others } = useMemo(() => splitPlatforms(counts, 8), [counts])
  const otherKeys = useMemo(() => others.map(o => o.key), [others])

  // A persisted platform that no longer has games (renamed system, emptied
  // library) would pin the page to an empty shelf — fall back to everything,
  // but only once every library has settled: a saved Steam shelf waits for
  // Steam instead of flashing All Games first.
  const settling = lib.isLoading || lib.providersLoading
  const effectivePlatform = useMemo(() => {
    if (platform === ALL_PLATFORMS) return ALL_PLATFORMS
    if (platform === OTHER_PLATFORMS) return others.length || settling ? OTHER_PLATFORMS : ALL_PLATFORMS
    return counts.some(c => c.key === platform) || settling ? platform : ALL_PLATFORMS
  }, [platform, others.length, counts, settling])

  const fixedStatus = STATUS_SECTIONS[section]
  // The same fallback for a status section's platform: a saved scope with no
  // games of that status left would show an empty grid under the label "All".
  const effectiveScopePlatform = useMemo(() => {
    if (!fixedStatus || scopePlatform === ALL_PLATFORMS || settling) return scopePlatform
    return lib.games.some(g => !g.hidden && effectiveStatus(g) === fixedStatus && g.platformKey === scopePlatform) ? scopePlatform : ALL_PLATFORMS
  }, [fixedStatus, scopePlatform, settling, lib.games])
  const isGameSection = section !== 'analytics' && section !== 'advanced' && section !== 'scrape'
  // Sorted once per library change or sort change; every filter below keeps
  // that order, so a keystroke filters a sorted list instead of re-sorting.
  const sorted = useMemo(() => sortGames(lib.games, sort), [lib.games, sort])
  const scope = useMemo(
    () => scopeGames(sorted, { section, platform: effectivePlatform, otherKeys, scopePlatform: effectiveScopePlatform, search, genres, studios, ids }),
    [sorted, section, effectivePlatform, otherKeys, effectiveScopePlatform, search, genres, studios, ids],
  )
  const genreList = useMemo(
    // The Hidden view lists hidden games, so its genre list counts them too.
    () => foldGenres(scopeGames(lib.games, { section, platform: effectivePlatform, otherKeys, scopePlatform: effectiveScopePlatform, search, studios, ids }),
      section === 'library' && statuses.includes('hidden')),
    [lib.games, section, effectivePlatform, otherKeys, effectiveScopePlatform, search, statuses, studios, ids],
  )
  // Each facet's options are narrowed by every OTHER filter, never by itself.
  const studioList = useMemo(
    () => studioOptions(scopeGames(lib.games, { section, platform: effectivePlatform, otherKeys, scopePlatform: effectiveScopePlatform, search, genres, ids }),
      section === 'library' && statuses.includes('hidden')),
    [lib.games, section, effectivePlatform, otherKeys, effectiveScopePlatform, search, genres, statuses, ids],
  )
  const sCounts = useMemo(() => statusCounts(scope), [scope])
  // The shelf before any narrowing (search, genre, studio, an Analytics list):
  // the "of N" in "12 of 310 games" — the narrowed scope made it "12 of 12".
  const shelfTotal = useMemo(
    () => statusCounts(scopeGames(lib.games, { section, platform: effectivePlatform, otherKeys, scopePlatform: effectiveScopePlatform, search: '' })).all,
    [lib.games, section, effectivePlatform, otherKeys, effectiveScopePlatform],
  )

  const visible = useMemo(() => {
    if (section === 'queue') return queueOrder(applyStatus(scope, 'all'))
    // Advanced's Random pool: no status filter Advanced could not show.
    if (!isGameSection) return applyStatus(scope, 'all')
    return applyStatus(scope, fixedStatus ? 'all' : statuses)
  }, [scope, section, isGameSection, fixedStatus, statuses])

  const ranks = useMemo(() => queueRanks(lib.games), [lib.games])
  const navCounts = useMemo(() => {
    const all = statusCounts(lib.games)
    // Needs review, from the rows the page holds (the same rule the tab lists).
    const review = lib.games.reduce((n, g) => n + (needsReviewReasons(g).length > 0 ? 1 : 0), 0)
    return { queue: ranks.size, wishlist: all.wishlist, completed: all.completed, backlog: all.backlog, review }
  }, [lib.games, ranks])

  return {
    counts, shown, others, effectivePlatform, effectiveScopePlatform, isGameSection, genres: genreList, studios: studioList,
    statusCounts: sCounts, shelfTotal, visible, ranks, navCounts,
  }
}
