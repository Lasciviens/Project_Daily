import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchGamesNeedingReview } from '../api/gamesApi'
import { useTestGameStore, type AdvancedTab } from './testGameStore'
import {
  ALL_PLATFORMS, OTHER_PLATFORMS, STATUS_SECTIONS, STATUS_TABS, STATUS_TEXT,
  platformCounts, platformInfo, platformLabels,
  type StatusCounts, type TgGame, type TgSection, type TgStatusFilter,
} from './testGameModel'
import type { TgHeaderConfig } from './tgTypes'
import { ADVANCED_TABS } from './advancedTabs'

// The main column's heading — title, count line and tab pills — for whichever
// section is open. The desktop TgHeader and the phone TgMobileHeader both
// render this one config, so the two layouts can never disagree.

const SECTION_TITLE: Record<TgSection, string> = {
  library: 'Library', queue: 'Play Queue', wishlist: 'Wishlist', completed: 'Completed',
  backlog: 'Backlog', analytics: 'Analytics', advanced: 'Advanced',
}

function plural(n: number, word: string) { return `${n} ${word}${n === 1 ? '' : 's'}` }

interface Input {
  games: TgGame[]
  /** The Library's platform after the stale-platform fallback. */
  platform: string
  /** Status counts of the games in scope (the Library's status tabs). */
  statusCounts: StatusCounts
  /** How many games the current section shows. */
  visibleCount: number
}

export function useTgHeaderConfig({ games, platform, statusCounts: sCounts, visibleCount }: Input): TgHeaderConfig {
  const section = useTestGameStore(s => s.section)
  const statuses = useTestGameStore(s => s.statuses)
  const scopePlatform = useTestGameStore(s => s.scopePlatform)
  const advancedTab = useTestGameStore(s => s.advancedTab)
  const setStatus = useTestGameStore(s => s.setStatus)
  const setScopePlatform = useTestGameStore(s => s.setScopePlatform)
  const setAdvancedTab = useTestGameStore(s => s.setAdvancedTab)

  // The "Needs review" pill's count, as the current page's Review tab shows
  // it. Same key and query as useGamesNeedingReview, so the tab itself reuses
  // this request — but only fetched while Advanced is open, since it reads the
  // whole library a second time.
  const needsReview = useQuery({
    queryKey: ['games', 'needs-review'],
    queryFn: fetchGamesNeedingReview,
    staleTime: 60_000,
    enabled: section === 'advanced',
  })
  const reviewCount = needsReview.data?.length

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
      const inStatus = games.filter(g => !g.hidden && g.play_status === fixedStatus)
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
    return {
      title: 'Advanced',
      subtitle: 'Everything from the current Games page the new design has no place for yet',
      logo: 'advanced',
      tabs: ADVANCED_TABS.map(t => ({
        key: t.key, label: t.label, count: t.key === 'review' && reviewCount ? reviewCount : undefined,
      })),
      activeTab: advancedTab,
      onTab: (k) => setAdvancedTab(k as AdvancedTab),
    }
  }, [section, platform, sCounts, statuses, fixedStatus, games, scopePlatform, visibleCount,
      advancedTab, reviewCount, setStatus, setScopePlatform, setAdvancedTab])
}
