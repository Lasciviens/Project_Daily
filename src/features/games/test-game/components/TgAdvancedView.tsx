import type { ReactNode } from 'react'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { LibraryTab } from '../../pages/GamesPage'
import { TierEditorTab } from '../../components/TierEditorTab'
import { PlayQueueTab } from '../../components/PlayQueueTab'
import { NeedsReviewTab } from '../../components/NeedsReviewTab'
import { ScreenScraperStudio } from '../../components/studio/ScreenScraperStudio'
import { SteamTab } from '../../components/SteamTab'
import { PlayStationTab } from '../../components/PlayStationTab'
import { useTestGameStore, type AdvancedTab } from '../testGameStore'
import type { TgGame } from '../testGameModel'
import type { TgRandomScope } from '../advancedTabs'
import { TgAdvancedViewTools } from './TgAdvancedViewTools'

// Every feature of the current Games page the new design has no place for
// yet, mounted verbatim — same components, same hooks, same data — so nothing
// is lost while they are brought into the design one at a time. The header
// renders the tab pills; this only renders the active tab.

const INTRO: Record<AdvancedTab, string> = {
  classic: 'The current Games page library — every filter and all six views, reused as-is.',
  tiers: 'The existing tier editor, reused as-is.',
  queue: 'The existing drag-and-drop queue editor, reused as-is. Play Queue shows the same queue in the new design.',
  review: 'Games missing a cover, genres, a year or a platform — the existing Needs review list, reused as-is.',
  scraper: 'The existing ScreenScraper studio, reused as-is.',
  steam: 'The existing Steam tab — library, achievements and store pages — reused as-is.',
  playstation: 'The existing PlayStation tab — library, playtime and trophies — reused as-is.',
  tools: 'The current page’s Add game and Random buttons, reused as-is.',
}

export function TgAdvancedView({ onOpenDetail, randomPool, randomScope }: {
  onOpenDetail: (id: string) => void
  randomPool: TgGame[]
  randomScope: TgRandomScope
}) {
  const tab = useTestGameStore(s => s.advancedTab)
  // A persisted tab from an older build may no longer exist.
  const active: AdvancedTab = tab in INTRO ? tab : 'classic'

  let content: ReactNode
  switch (active) {
    case 'tiers': content = <TierEditorTab />; break
    case 'queue': content = <PlayQueueTab />; break
    case 'review': content = <NeedsReviewTab onOpenDetail={onOpenDetail} />; break
    // The next three render reverse-engineered or third-party payloads; a
    // render-time throw stays inside this card instead of blanking the page.
    case 'scraper':
      content = <ErrorBoundary label="ScreenScraper" action="test_game_scraper"><ScreenScraperStudio /></ErrorBoundary>
      break
    case 'steam':
      content = <ErrorBoundary label="Steam" action="test_game_steam_tab"><SteamTab /></ErrorBoundary>
      break
    case 'playstation':
      content = <ErrorBoundary label="PlayStation" action="test_game_psn_tab"><PlayStationTab /></ErrorBoundary>
      break
    case 'tools': content = <TgAdvancedViewTools onOpenDetail={onOpenDetail} randomPool={randomPool} scope={randomScope} />; break
    default: content = <LibraryTab onOpenDetail={onOpenDetail} />
  }

  return (
    // Keyed by tab: each feature mounts fresh, and a boundary that caught an
    // error in one tab never carries that error into the next.
    <div key={active} className="tg-panel p-4 sm:p-5">
      <p className="mb-4 text-[12.5px] tg-muted">{INTRO[active]}</p>
      {content}
    </div>
  )
}
