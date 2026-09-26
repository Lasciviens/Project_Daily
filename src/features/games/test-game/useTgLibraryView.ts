import { useMemo } from 'react'
import { useTestGameStore } from './testGameStore'
import {
  ALL_PLATFORMS, OTHER_PLATFORMS, STATUS_SECTIONS,
  applyStatus, foldGenres, platformCounts, queueOrder, queueRanks,
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
  statusCounts: StatusCounts
  /** The current section's games in display order (Advanced: the Random pool). */
  visible: TgGame[]
  /** ONE queue numbering for the badges, the queue rows and the ⋯ menu. */
  ranks: Map<string, number>
  navCounts: { queue: number; wishlist: number; completed: number; backlog: number }
}

export function useTgLibraryView(lib: TestGameLibrary): TgLibraryView {
  const section = useTestGameStore(s => s.section)
  const platform = useTestGameStore(s => s.platform)
  const scopePlatform = useTestGameStore(s => s.scopePlatform)
  const statuses = useTestGameStore(s => s.statuses)
  const genres = useTestGameStore(s => s.genres)
  const sort = useTestGameStore(s => s.sort)
  const search = useTestGameStore(s => s.search)

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
    return lib.games.some(g => !g.hidden && g.play_status === fixedStatus && g.platformKey === scopePlatform) ? scopePlatform : ALL_PLATFORMS
  }, [fixedStatus, scopePlatform, settling, lib.games])
  const isGameSection = section !== 'analytics' && section !== 'advanced' && section !== 'scrape'
  const scope = useMemo(
    () => scopeGames(lib.games, { section, platform: effectivePlatform, otherKeys, scopePlatform: effectiveScopePlatform, search, genres }),
    [lib.games, section, effectivePlatform, otherKeys, effectiveScopePlatform, search, genres],
  )
  const genreList = useMemo(
    // The Hidden view lists hidden games, so its genre list counts them too.
    () => foldGenres(scopeGames(lib.games, { section, platform: effectivePlatform, otherKeys, scopePlatform: effectiveScopePlatform, search }),
      section === 'library' && statuses.includes('hidden')),
    [lib.games, section, effectivePlatform, otherKeys, effectiveScopePlatform, search, statuses],
  )
  const sCounts = useMemo(() => statusCounts(scope), [scope])

  const visible = useMemo(() => {
    if (section === 'queue') return queueOrder(applyStatus(scope, 'all'))
    // Advanced's Random pool: no status filter Advanced could not show.
    if (!isGameSection) return applyStatus(scope, 'all')
    return sortGames(applyStatus(scope, fixedStatus ? 'all' : statuses), sort)
  }, [scope, section, isGameSection, fixedStatus, statuses, sort])

  const ranks = useMemo(() => queueRanks(lib.games), [lib.games])
  const navCounts = useMemo(() => {
    const all = statusCounts(lib.games)
    return { queue: ranks.size, wishlist: all.wishlist, completed: all.completed, backlog: all.backlog }
  }, [lib.games, ranks])

  return {
    counts, shown, others, effectivePlatform, effectiveScopePlatform, isGameSection, genres: genreList,
    statusCounts: sCounts, visible, ranks, navCounts,
  }
}
