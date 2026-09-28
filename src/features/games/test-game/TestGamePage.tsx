import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import './testGame.css'
import { useTestGameLibrary } from './useTestGameLibrary'
import { useTestGameStore } from './testGameStore'
import { useBreakpoint } from '../../../shared/hooks/useBreakpoint'
import { useUIStore } from '../../../app/store'
import { useTgHeaderConfig } from './useTgHeaderConfig'
import { useTgLibraryView } from './useTgLibraryView'
import { useTgUrlSync } from './useTgUrlSync'
import type { TgGame } from './testGameModel'
import type { TgActions } from './tgTypes'
import { pickRandomId } from './components/tgRandom'
import { TgNavPanel } from './components/TgNavPanel'
import { TgToolbar } from './components/TgToolbar'
import { TgLibraryMenu } from './components/TgLibraryMenu'
import { TgHeader } from './components/TgHeader'
import { TgShelf } from './components/TgShelf'
import { TgGridView } from './components/TgGridView'
import { TgListView } from './components/TgListView'
import { TgDetailOverlayHost, type TgPickIntent } from './components/TgDetailOverlayHost'
import { TgDetailOverlayBackdrop } from './components/TgDetailOverlayBackdrop'
import { TgModals } from './components/TgModals'
import { TgMobileHeader, TgMobileGrid } from './components/TgMobile'
import { TgQueueView } from './components/TgQueueView'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { recalledDepth, rememberDepth } from './components/tgScrollMemory'
import { TgGamesContext, TgRanksContext } from './components/tgRanks'
import { TgChunkFailed, TgEmptyState, TgLoadingShelf, TgErrorState, TgProviderError } from './components/TgStates'
import { TgAnalyticsSkeleton } from './components/TgAnalyticsStates'
import { lazyWithReload } from '../../../shared/utils/lazyWithReload'

// /#/games — the Games page, on the "Game Library" design, inside the app
// shell like every other page (flagged `fullHeight` + `collapseSidebar` in the
// nav registry). It keeps its own look (testGame.css, scoped to `.tg-root`),
// its own navigation panel on the left (sections + every platform grouped by
// maker) and its own toolbar; on phones the app's header and tab bar frame it
// and the sections sit in a pill row. The section and platform are in the
// address (useTgUrlSync).

// Analytics, Scrape and Advanced load on first visit: most sessions only
// browse the shelves, and together they are the bulk of the page's code.
const TgAnalyticsView = lazyWithReload('games-analytics', () => import('./components/TgAnalyticsView').then(m => m.TgAnalyticsView), TgChunkFailed)
const TgScrapeView = lazyWithReload('games-scrape', () => import('./components/scrape/TgScrapeView').then(m => m.TgScrapeView), TgChunkFailed)
const TgAdvancedView = lazyWithReload('games-advanced', () => import('./components/TgAdvancedView').then(m => m.TgAdvancedView), TgChunkFailed)

const SECTION_FALLBACK = <div aria-busy="true" className="h-full" />

export function TestGamePage() {
  useTgUrlSync()
  const lib = useTestGameLibrary()
  const bp = useBreakpoint()
  const phone = bp === 'phone'
  const reportScroll = useUIStore(s => s.reportScroll)
  const section = useTestGameStore(s => s.section)
  const pickedGenres = useTestGameStore(s => s.genres)
  const pickedStudios = useTestGameStore(s => s.studios)
  const libraryScope = useTestGameStore(s => s.libraryScope)
  const view = useTestGameStore(s => s.view)
  const search = useTestGameStore(s => s.search)
  const statuses = useTestGameStore(s => s.statuses)
  const sort = useTestGameStore(s => s.sort)
  const selectedId = useTestGameStore(s => s.selectedId)
  const detailOpen = useTestGameStore(s => s.detailOpen)
  const collapsed = useTestGameStore(s => s.detailCollapsed)
  const select = useTestGameStore(s => s.select)
  const openDetail = useTestGameStore(s => s.openDetail)
  const activateGame = useTestGameStore(s => s.activateGame)
  const closeDetail = useTestGameStore(s => s.closeDetail)
  const setDetailCollapsed = useTestGameStore(s => s.setDetailCollapsed)

  const [editId, setEditId] = useState<string | null>(null)
  const [fullId, setFullId] = useState<string | null>(null)
  const [provider, setProvider] = useState<TgGame | null>(null)
  const [planGame, setPlanGame] = useState<TgGame | null>(null)
  const pickRef = useRef<TgPickIntent>(null)
  const panelRef = useRef<HTMLElement>(null)

  const {
    groups, effectivePlatform, effectiveScopePlatform, isGameSection, genres, studios, statusCounts: sCounts, shelfTotal, visible, ranks, navCounts,
  } = useTgLibraryView(lib)

  // Looked up in the whole library, not the current view: a status changed in
  // the details can take the game out of the open tab, and its details must
  // not vanish mid-edit. Nothing is selected until the user picks a game.
  const selected = useMemo(
    () => (isGameSection && selectedId ? lib.games.find(g => g.id === selectedId) ?? null : null),
    [lib.games, selectedId, isGameSection],
  )
  const detailGame = detailOpen ? selected : null

  // The open game left the library (deleted from Edit, dropped by a provider
  // refetch): close its details rather than leave them "open" with nothing
  // shown, which made the next click only swap or tuck instead of opening.
  const libSettled = !lib.isLoading && !lib.providersLoading
  useEffect(() => {
    if (detailOpen && selectedId && libSettled && !lib.games.some(g => g.id === selectedId)) {
      select(null)
      closeDetail()
    }
  }, [detailOpen, selectedId, libSettled, lib.games, select, closeDetail])

  // Widening past the phone layout swaps the full-screen sheet for the
  // overlay; the sheet's focus target unmounts with the phone tree, so hand
  // focus to the overlay or Esc would reach nothing.
  const prevBp = useRef(bp)
  useEffect(() => {
    const was = prevBp.current
    prevBp.current = bp
    if (was === 'phone' && bp !== 'phone' && detailOpen && !collapsed) {
      requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    }
  }, [bp, detailOpen, collapsed])

  const header = useTgHeaderConfig({ games: lib.games, platform: effectivePlatform, statusCounts: sCounts, visibleCount: visible.length, shelfTotal, scopePlatform: effectiveScopePlatform })

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions: TgActions = useMemo(() => ({
    openEdit: (id) => setEditId(id),
    openFull: (id) => setFullId(id),
    openProvider: (g) => setProvider(g),
    planSession: (g) => setPlanGame(g),
  }), [])
  // Phone: a tap opens the full-screen sheet. Wider: an arrow key only walks
  // the selection (an open overlay follows it); a click opens the overlay and
  // leaves focus alone; Enter opens it and moves focus in.
  const onSelect = useCallback((id: string) => {
    const pick = pickRef.current
    pickRef.current = null
    if (phone) openDetail(id)
    else if (pick === 'arrow') {
      select(id)
      // The expanded overlay covers the right-hand columns. Walking onto a
      // card underneath it tucks the overlay into its tab (which follows the
      // selection) so the card being chosen is actually visible.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const panel = panelRef.current
        const card = document.querySelector<HTMLElement>(`[data-game-id="${CSS.escape(id)}"]`)
        if (!panel || !card || !panel.isConnected) return
        const p = panel.getBoundingClientRect()
        const c = card.getBoundingClientRect()
        if (p.width > 0 && c.right > p.left + 8 && c.bottom > p.top && c.top < p.bottom) setDetailCollapsed(true)
      }))
    }
    else if (activateGame(id) === 'opened' && pick === 'keyboard') {
      requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    }
  }, [phone, openDetail, select, activateGame, setDetailCollapsed])
  // "Pick a random game" draws from exactly what the page shows (section,
  // platform, status, genre and search all applied) and opens it.
  const pickRandom = useCallback(() => {
    const id = pickRandomId(visible, selectedId)
    if (!id) return
    // Always shown expanded: a pick that only moved the tucked tab showed nothing.
    openDetail(id)
  }, [visible, selectedId, openDetail])
  const onRandom = isGameSection && visible.length > 0 ? pickRandom : undefined
  const closeModal = useCallback((which: 'edit' | 'full' | 'provider') => {
    if (which === 'edit') setEditId(null)
    else if (which === 'full') setFullId(null)
    else setProvider(null)
  }, [])

  // What makes the list a different list. A change scrolls it back to the
  // top (and remounts the phone grid's paging); a status edit or a refetch
  // does not change it, so those keep the scroll position.
  const listKey = [section, effectivePlatform, effectiveScopePlatform, statuses.join(','), pickedGenres.join(','), pickedStudios.join(','), libraryScope?.label ?? '', sort, search.trim()].join('|')

  // Phone: every section shares one scroller. Each section's depth is kept,
  // so Queue → Library returns to the same card; a new filter starts at the top.
  const phoneScroll = useRef<HTMLDivElement>(null)
  const lastList = useRef({ section, listKey })
  useLayoutEffect(() => {
    const el = phoneScroll.current
    const prev = lastList.current
    lastList.current = { section, listKey }
    if (!el || (prev.section === section && prev.listKey === listKey)) return
    el.scrollTo({ top: prev.section !== section ? recalledDepth(listKey) : 0 })
  }, [section, listKey])

  // ── Content ───────────────────────────────────────────────────────────────
  function renderGames(layout: 'desktop' | 'phone') {
    if (lib.isLoading) return <TgLoadingShelf />
    if (lib.isError) return <TgErrorState error={lib.error} onRetry={lib.refetch} />
    // Steam / PlayStation may still bring this view's games (a saved Steam
    // shelf, a queued PlayStation game): wait for them rather than say "empty".
    if (visible.length === 0 && lib.providersLoading) return <TgLoadingShelf />
    if (lib.games.length === 0) return <TgEmptyState kind="library" />
    if (visible.length === 0) return <TgEmptyState kind={search.trim() || pickedGenres.length || pickedStudios.length || libraryScope ? 'filtered' : section === 'queue' ? 'queue' : 'section'} />
    const selId = selected?.id ?? null
    if (section === 'queue') {
      return <TgQueueView games={visible} ranks={ranks} selectedId={selId} onSelect={onSelect} fill={layout === 'desktop'} onPlan={actions.planSession} />
    }
    if (layout === 'phone') return <TgMobileGrid key={listKey} listKey={listKey} games={visible} onSelect={onSelect} />
    if (view === 'grid') return <TgGridView games={visible} selectedId={selId} onSelect={onSelect} resetKey={listKey} />
    if (view === 'list') return <TgListView games={visible} selectedId={selId} onSelect={onSelect} resetKey={listKey} />
    return <TgShelf games={visible} selectedId={selId} onSelect={onSelect} resetKey={listKey} />
  }

  function renderSection(layout: 'desktop' | 'phone') {
    if (section === 'analytics') {
      return (
        <ErrorBoundary label="Analytics" action="games_analytics">
          <Suspense fallback={<div className="@container pb-4 pt-2"><TgAnalyticsSkeleton /></div>}><TgAnalyticsView lib={lib} /></Suspense>
        </ErrorBoundary>
      )
    }
    if (section === 'scrape') return <Suspense fallback={SECTION_FALLBACK}><TgScrapeView games={lib.games} loading={lib.isLoading} layout={layout} /></Suspense>
    if (section === 'advanced') {
      return (
        <Suspense fallback={SECTION_FALLBACK}>
          <TgAdvancedView onOpenDetail={actions.openFull} games={lib.games} loading={lib.isLoading} error={lib.isError ? lib.error : null} onRetry={lib.refetch} />
        </Suspense>
      )
    }
    return renderGames(layout)
  }

  const providerError = isGameSection && !lib.isError && lib.providerError != null
    ? <TgProviderError error={lib.providerError} onRetry={lib.retryProviders} />
    : null

  return (
    <TgRanksContext.Provider value={ranks}>
    <TgGamesContext.Provider value={lib.games}>
      {phone ? (
        <div key="phone" className="tg-root flex h-full flex-col overflow-hidden">
          <TgMobileHeader
            groups={groups} counts={navCounts} genres={genres} studios={studios} statusCounts={sCounts} header={header}
            onRandom={onRandom} resultCount={visible.length} libraryGames={lib.games}
          />
          <div
            ref={phoneScroll}
            // The app header hides while this list scrolls down, as it does over <main>.
            onScroll={e => { rememberDepth(listKey, e.currentTarget.scrollTop); reportScroll(e.currentTarget.scrollTop) }}
            className="tg-scroll-y min-h-0 flex-1 pb-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-2"
          >
            {providerError}
            {renderSection('phone')}
          </div>
        </div>
      ) : (
        <div key="wide" className="tg-root flex h-full overflow-hidden">
          <TgNavPanel counts={navCounts} groups={groups} />
          <div className="relative flex min-w-0 flex-1 flex-col">
            <TgDetailOverlayBackdrop selected={selected} games={lib.games} />
            {/* Analytics, Scrape and Advanced have nothing to search or sort:
                no toolbar row, and the ⋯ menu sits at the end of their heading. */}
            {isGameSection ? (
              <TgToolbar
                genres={genres} studios={studios} statusCounts={sCounts} showStatus={section === 'library'}
                showViews={section !== 'queue'} showSort={section !== 'queue'}
                onRandom={onRandom} randomCount={visible.length}
              />
            ) : <div aria-hidden className="h-3 shrink-0" />}
            <TgDetailOverlayHost
              game={detailGame} actions={actions} scroll={!isGameSection} pickRef={pickRef} panelRef={panelRef} reserve={section === 'queue'}
              header={<><TgHeader config={isGameSection ? header : { ...header, action: <>{header.action}<TgLibraryMenu className="-mr-1" /></> }} />{providerError}</>}
            >
              {renderSection('desktop')}
            </TgDetailOverlayHost>
          </div>
        </div>
      )}
      <TgModals
        bp={bp} actions={actions} sheetGame={collapsed ? null : detailGame} onCloseSheet={closeDetail}
        editId={editId} fullId={fullId} provider={provider} onClose={closeModal}
        planGame={planGame} onClosePlan={() => setPlanGame(null)}
      />
    </TgGamesContext.Provider>
    </TgRanksContext.Provider>
  )
}
