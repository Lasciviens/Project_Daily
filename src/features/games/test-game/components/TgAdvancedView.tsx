import type { ReactNode } from 'react'
import { Gamepad2, Monitor, ScanSearch, Wand2, type LucideIcon } from 'lucide-react'
import { ErrorBoundary } from '../../../../shared/components/ErrorBoundary'
import { NeedsReviewTab } from '../../components/NeedsReviewTab'
import { ScreenScraperStudio } from '../../components/studio/ScreenScraperStudio'
import { SteamTab } from '../../components/SteamTab'
import { PlayStationTab } from '../../components/PlayStationTab'
import { useTestGameStore, type AdvancedTab } from '../testGameStore'
import type { TgGame } from '../testGameModel'
import type { TgRandomScope } from '../advancedTabs'

// The previous Games page's tools the new design has no place for yet,
// mounted verbatim — same components, same hooks, same data. The header
// renders the tab pills; this renders the active tab inside the page's own
// chrome. The legacy component sits in `.tg-legacy`, which remaps the app's
// cream/ink/accent tokens onto this page's palette (testGame.css), so it
// reads as part of the page in both themes without being rewritten.

const TABS: Record<AdvancedTab, { title: string; intro: string; Icon: LucideIcon }> = {
  review: {
    title: 'Needs review', Icon: ScanSearch,
    intro: 'Games missing a cover, genres, a year or a platform.',
  },
  scraper: {
    title: 'ScreenScraper', Icon: Wand2,
    intro: 'Fill in missing metadata and artwork from ScreenScraper.',
  },
  steam: {
    title: 'Steam', Icon: Monitor,
    intro: 'Your Steam library, achievements and store pages.',
  },
  playstation: {
    title: 'PlayStation', Icon: Gamepad2,
    intro: 'Your PlayStation library, playtime and trophies.',
  },
}

export function TgAdvancedView({ onOpenDetail }: {
  onOpenDetail: (id: string) => void
  /** Accepted for older callers; Random lives in the top bar now. */
  randomPool?: TgGame[]
  randomScope?: TgRandomScope
}) {
  const tab = useTestGameStore(s => s.advancedTab)
  // A persisted tab from an older build may no longer exist.
  const active: AdvancedTab = tab in TABS ? tab : 'review'
  const { title, intro, Icon } = TABS[active]

  let content: ReactNode
  switch (active) {
    // The last three render reverse-engineered or third-party payloads; a
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
    default:
      content = <NeedsReviewTab onOpenDetail={onOpenDetail} />
  }

  return (
    // Keyed by tab: each feature mounts fresh, and a boundary that caught an
    // error in one tab never carries that error into the next.
    <section key={active} aria-labelledby="tg-adv-title" className="tg-panel tg-adv overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[var(--tg-border)] px-4 py-3.5 sm:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--tg-accent-soft)] text-[var(--tg-accent)]">
          <Icon size={20} strokeWidth={2} aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="tg-adv-title" className="truncate text-[15px] font-semibold text-[var(--tg-text)]">{title}</h2>
          <p className="text-[12.5px] leading-snug tg-muted">{intro}</p>
        </div>
      </header>
      <div className="tg-legacy p-3 sm:p-5">{content}</div>
    </section>
  )
}
