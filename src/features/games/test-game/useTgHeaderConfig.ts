import { useMemo } from 'react'
import { useTestGameStore, type AdvancedTab, type ScrapeMode } from './testGameStore'
import {
  ALL_PLATFORMS, OTHER_PLATFORMS, STATUS_SECTIONS, STATUS_TABS, STATUS_TEXT,
  needsReviewReasons, platformCounts, platformInfo, platformLabels, scopeGames,
  type StatusCounts, type TgGame, type TgSection, type TgStatusFilter,
} from './testGameModel'
import type { TgHeaderConfig } from './tgTypes'
import { ADVANCED_TABS } from './advancedTabs'

// The main column's heading — title, count line and tab pills — for whichever
// section is open. The desktop TgHeader and the phone TgMobileHeader both
// render this one config, so the two layouts can never disagree.

const SECTION_TITLE: Record<TgSection, string> = {
  library: 'Library', queue: 'Play Queue', wishlist: 'Wishlist', completed: 'Completed',
  backlog: 'Backlog', analytics: 'Analytics', scrape: 'Scrape', advanced: 'Advanced',
}

function plural(n: number, word: string) { return `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : 's'}` }

interface Input {
  games: TgGame[]
  /** The Library's platform after the stale-platform fallback. */
  platform: string
  /** Status counts of the games in scope (the Library's status tabs). */
  statusCounts: StatusCounts
  /** How many games the current section shows. */
  visibleCount: number
  /** A status section's platform scope after the stale-scope fallback. */
  scopePlatform?: string
}

export function useTgHeaderConfig({ games, platform, statusCounts: sCounts, visibleCount, scopePlatform: effectiveScope }: Input): TgHeaderConfig {
  const section = useTestGameStore(s => s.section)
  const statuses = useTestGameStore(s => s.statuses)
  const storedScope = useTestGameStore(s => s.scopePlatform)
  const scopePlatform = effectiveScope ?? storedScope
  const genres = useTestGameStore(s => s.genres)
  const search = useTestGameStore(s => s.search)
  const advancedTab = useTestGameStore(s => s.advancedTab)
  const setStatus = useTestGameStore(s => s.setStatus)
  const setScopePlatform = useTestGameStore(s => s.setScopePlatform)
  const setAdvancedTab = useTestGameStore(s => s.setAdvancedTab)
  const scrapeMode = useTestGameStore(s => s.scrapeMode)
  const setScrapeMode = useTestGameStore(s => s.setScrapeMode)

  // The "Needs review" pill's count, from the rows the page already holds
  // (the same predicate the tab lists) — never a second library download.
  const reviewCount = useMemo(
    () => (section === 'advanced' ? games.filter(g => needsReviewReasons(g).length > 0).length : 0),
    [section, games],
  )

  const fixedStatus = STATUS_SECTIONS[section]
  return useMemo((): TgHeaderConfig => {
    if (section === 'library') {
      return {
        title: platformInfo(platform).name,
        subtitle: plural(sCounts.all, 'game'),
        logo: platform === ALL_PLATFORMS ? 'all' : platform === OTHER_PLATFORMS ? 'others' : 'platform',
        platformKey: platform,
        tabs: STATUS_TABS.map(s => ({ key: s, label: STATUS_TEXT[s], count: sCounts[s] })),
        // Several statuses can be picked in the filter menus; every picked one
        // that has a tab lights up. A tab selects only its status, and a tab
        // that is already the whole filter (or All) clears it.
        activeTab: statuses.length ? null : 'all',
        activeTabs: statuses.length ? statuses : ['all'],
        onTab: (k) => {
          const only = statuses.length === 1 && statuses[0] === k
          setStatus(only ? 'all' : k as TgStatusFilter)
        },
      }
    }
    if (fixedStatus) {
      // The genre and search filters apply to the counts too (the platform
      // scope does not — the tabs ARE the platform scope).
      const inStatus = scopeGames(games, { section, platform: ALL_PLATFORMS, scopePlatform: ALL_PLATFORMS, search, genres })
      const byPlatform = platformCounts(inStatus)
      const labels = platformLabels(byPlatform)
      return {
        title: SECTION_TITLE[section],
        subtitle: `${plural(inStatus.length, 'game')} across ${plural(byPlatform.length, 'platform')}`,
        logo: section as TgHeaderConfig['logo'],
        tabs: [
          { key: ALL_PLATFORMS, label: 'All', count: inStatus.length },
          ...byPlatform.map(p => ({ key: p.key, label: labels.get(p.key) ?? p.info.short, count: p.count })),
        ],
        activeTab: scopePlatform,
        onTab: setScopePlatform,
      }
    }
    if (section === 'queue') {
      return { title: 'Play Queue', subtitle: `${plural(visibleCount, 'game')} · in play order`, logo: 'queue', tabs: [], activeTab: null }
    }
    if (section === 'analytics') {
      return { title: 'Analytics', subtitle: 'Your library in numbers', logo: 'analytics', tabs: [], activeTab: null }
    }
    if (section === 'scrape') {
      return {
        title: 'Scrape', subtitle: 'Find a game on ScreenScraper and choose what to save', logo: 'scrape',
        tabs: [{ key: 'search', label: 'One game' }, { key: 'batch', label: 'Many games' }],
        activeTab: scrapeMode, onTab: (k) => setScrapeMode(k as ScrapeMode),
      }
    }
    return {
      title: 'Advanced',
      subtitle: 'Data quality and the Steam & PlayStation libraries',
      logo: 'advanced',
      tabs: ADVANCED_TABS.map(t => ({
        key: t.key, label: t.label, count: t.key === 'review' && reviewCount ? reviewCount : undefined,
      })),
      activeTab: advancedTab,
      onTab: (k) => setAdvancedTab(k as AdvancedTab),
    }
  }, [section, platform, sCounts, statuses, fixedStatus, games, scopePlatform, visibleCount,
      advancedTab, reviewCount, setStatus, setScopePlatform, setAdvancedTab, scrapeMode, setScrapeMode, search, genres])
}
