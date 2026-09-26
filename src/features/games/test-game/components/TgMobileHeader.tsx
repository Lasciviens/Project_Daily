import { useCallback, useState } from 'react'
import { Search, Settings2, X } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { PlatformCount, StatusCounts, TgGame } from '../testGameModel'
import type { TgHeaderConfig } from '../tgTypes'
import { TgUserMenu } from './TgUserMenu'
import { TgMobileGamepad } from './TgMobileGlyph'
import { TgMobileScope } from './TgMobileScope'
import { TgMobileListTools } from './TgMobileListTools'
import { TgRandomButton } from './TgRandomButton'
import { TgProviderSync } from './TgProviderSync'
import { TgQueueCleanup } from './TgQueueCleanup'

// Horizontal padding that also clears a landscape notch — the design's ~20px
// phone gutter, matching the grid's cover edges. The chip row's scroll padding
// repeats it so a chip scrolled into view keeps the gutter.
const GUTTER = 'pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))]'
const SCROLL_GUTTER = 'scroll-pl-[max(1.25rem,env(safe-area-inset-left))] scroll-pr-[max(1.25rem,env(safe-area-inset-right))]'

export function TgMobileHeader({ platforms, genres, studios, statusCounts, header, onRandom, resultCount, libraryGames }: {
  /** Opens a random game from the visible list; absent when the list is empty. */
  onRandom?: () => void
  platforms: PlatformCount[]
  genres: { genre: string; count: number }[]
  studios?: { studio: string; count: number }[]
  /** Games the current filters leave (the count line, the filter sheet's button). */
  resultCount?: number
  /** The whole library (a provider shelf's Sync reads its last sync from it). */
  libraryGames?: readonly TgGame[]
  statusCounts: StatusCounts
  header: TgHeaderConfig
}) {
  const section = useTestGameStore(s => s.section)
  const search = useTestGameStore(s => s.search)
  const setSearch = useTestGameStore(s => s.setSearch)
  const scrapeReviewing = useTestGameStore(s => s.section === 'scrape' && s.scrapeMode === 'search' && !!s.scrapeReview)
  const setScrapeSettingsOpen = useTestGameStore(s => s.setScrapeSettingsOpen)
  const [searchOpen, setSearchOpen] = useState(false)
  // An open but empty field doesn't follow you to another section (it would
  // come back focused, keyboard up, on a tab where you never asked for it).
  const [searchSection, setSearchSection] = useState(section)
  if (searchSection !== section) {
    setSearchSection(section)
    setSearchOpen(false)
  }

  // Search, filters and sort only exist where there is a game list to narrow.
  const hasFilters = section !== 'analytics' && section !== 'advanced' && section !== 'scrape'
  // A live query keeps the field open, so the list is never filtered by text you can't see.
  const showSearch = hasFilters && (searchOpen || search !== '')
  const closeSearch = () => { setSearch(''); setSearchOpen(false) }

  const showStatus = section === 'library'
  const showSort = section !== 'queue' // the queue is always in play order

  // Keeps the active Advanced chip on screen when it sits past the row's edge.
  const revealChip = useCallback((el: HTMLButtonElement | null) => {
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [])

  return (
    <header className="shrink-0 pt-[env(safe-area-inset-top)]">
      <div className={`flex h-[60px] items-center justify-between gap-3 ${GUTTER}`}>
        <div className="flex min-w-0 items-center gap-2.5">
          <TgMobileGamepad size={30} className="shrink-0 text-[var(--tg-text)]" />
          <h1 className="truncate text-[19px] font-bold tracking-[-0.01em]">Game Library</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {section === 'scrape' && (
            <button type="button" onClick={() => setScrapeSettingsOpen(true)} aria-label="What to save" className="tg-icon-btn">
              <Settings2 size={20} strokeWidth={1.9} />
            </button>
          )}
          {hasFilters && <TgRandomButton onPick={onRandom} count={resultCount} />}
          {hasFilters && (
            <button
              type="button"
              onClick={() => (showSearch ? closeSearch() : setSearchOpen(true))}
              aria-label={showSearch ? 'Close search' : 'Search games'}
              aria-expanded={showSearch}
              className="tg-icon-btn"
            >
              <Search size={20} strokeWidth={1.9} />
            </button>
          )}
          <TgUserMenu />
        </div>
      </div>

      {showSearch && (
        <div className={`pb-2 ${GUTTER}`}>
          <div className="relative">
            <Search size={17} strokeWidth={1.9} aria-hidden className="tg-faint pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') closeSearch() }}
              placeholder="Search games, consoles, or tags..."
              aria-label="Search games"
              className="tg-input pl-10 pr-11"
            />
            <button
              type="button"
              onClick={closeSearch}
              aria-label="Clear and close search"
              className="tg-muted absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[11px]"
            >
              <X size={17} strokeWidth={2} />
            </button>
          </div>
        </div>
      )}

      <div className={`flex min-h-[48px] items-center justify-between gap-3 pb-2 pt-1 ${GUTTER}`}>
        <TgMobileScope platforms={platforms} header={header} />
        {section === 'library' && (header.platformKey === 'steam' || header.platformKey === 'playstation') && (
          <TgProviderSync library={header.platformKey} games={libraryGames ?? []} compact />
        )}
        {section === 'queue' && <TgQueueCleanup games={libraryGames ?? []} compact />}
        {hasFilters && (
          <TgMobileListTools genres={genres} studios={studios} statusCounts={statusCounts} showStatus={showStatus} showSort={showSort} resultCount={resultCount} />
        )}
      </div>
      {/* Filtered: how many games are left, and one tap back to all of them. */}
      {hasFilters && header.onClear && (
        <div className={`-mt-1 flex items-center gap-2 pb-2 text-[12px] ${GUTTER}`}>
          <span className="tabular-nums tg-muted">{header.subtitle}</span>
          <button type="button" onClick={header.onClear} className="inline-flex min-h-[44px] items-center font-semibold text-[var(--tg-accent)]">Clear filters</button>
        </div>
      )}

      {(section === 'advanced' || (section === 'scrape' && !scrapeReviewing)) && header.tabs.length > 0 && (
        <div className={`tg-scroll-x flex gap-2 pb-2 ${GUTTER} ${SCROLL_GUTTER}`}>
          {header.tabs.map(t => {
            const active = t.key === header.activeTab
            return (
              <button
                key={t.key}
                ref={active ? revealChip : undefined}
                type="button"
                aria-pressed={active}
                onClick={() => header.onTab?.(t.key)}
                className={`tg-tab shrink-0 border ${active ? 'is-active border-transparent' : 'border-[var(--tg-border)]'}`}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      )}

    </header>
  )
}
