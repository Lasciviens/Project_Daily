import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './testGame.css'
import { useTestGameLibrary } from './useTestGameLibrary'
import { useTestGameStore } from './testGameStore'
import { useTgBreakpoint } from './useTgBreakpoint'
import { useTgHeaderConfig } from './useTgHeaderConfig'
import { useTgLibraryView } from './useTgLibraryView'
import type { TgGame } from './testGameModel'
import type { TgActions } from './tgTypes'
import { TgSidebar } from './components/TgSidebar'
import { TgTopBar } from './components/TgTopBar'
import { TgHeader } from './components/TgHeader'
import { TgShelf } from './components/TgShelf'
import { TgGridView } from './components/TgGridView'
import { TgListView } from './components/TgListView'
import { TgDetailOverlayHost, type TgPickIntent } from './components/TgDetailOverlayHost'
import { TgDetailOverlayBackdrop } from './components/TgDetailOverlayBackdrop'
import { TgModals } from './components/TgModals'
import { TgMobileHeader, TgBottomTabs, TgMobileGrid } from './components/TgMobile'
import { TgQueueView } from './components/TgQueueView'
import { TgAnalyticsView } from './components/TgAnalyticsView'
import { TgAdvancedView } from './components/TgAdvancedView'
import { TgEmptyState, TgLoadingShelf, TgErrorState, TgProviderError } from './components/TgStates'

// /#/test-game — the Games page rebuilt on the "Game Library" design. It lives
// outside the app shell (its own sidebar, top bar and phone tab bar, as the
// design draws them) and reads and writes the SAME tables through the SAME
// hooks as /#/games. What the design has no place for yet lives under Advanced.

export function TestGamePage() {
  const lib = useTestGameLibrary()
  const bp = useTgBreakpoint()
  const section = useTestGameStore(s => s.section)
  const pickedGenres = useTestGameStore(s => s.genres)
  const view = useTestGameStore(s => s.view)
  const search = useTestGameStore(s => s.search)
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
  const pickRef = useRef<TgPickIntent>(null)
  const panelRef = useRef<HTMLElement>(null)

  const {
    counts, shown, others, effectivePlatform, isGameSection, genres, statusCounts: sCounts, visible, ranks, navCounts,
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
    if (was === 'mobile' && bp !== 'mobile' && detailOpen && !collapsed) {
      requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }))
    }
  }, [bp, detailOpen, collapsed])

  const header = useTgHeaderConfig({ games: lib.games, platform: effectivePlatform, statusCounts: sCounts, visibleCount: visible.length })

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions: TgActions = useMemo(() => ({
    openEdit: (id) => setEditId(id),
    openFull: (id) => setFullId(id),
    openProvider: (g) => setProvider(g),
  }), [])
  // Phone: a tap opens the full-screen sheet. Wider: an arrow key only walks
  // the selection (an open overlay follows it); a click opens the overlay and
  // leaves focus alone; Enter opens it and moves focus in.
  const onSelect = useCallback((id: string) => {
    const pick = pickRef.current
    pickRef.current = null
    if (bp === 'mobile') openDetail(id)
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
  }, [bp, openDetail, select, activateGame, setDetailCollapsed])
  const closeModal = useCallback((which: 'edit' | 'full' | 'provider') => {
    if (which === 'edit') setEditId(null)
    else if (which === 'full') setFullId(null)
    else setProvider(null)
  }, [])

  // ── Content ───────────────────────────────────────────────────────────────
  function renderGames(layout: 'desktop' | 'mobile') {
    if (lib.isLoading) return <TgLoadingShelf />
    if (lib.isError) return <TgErrorState error={lib.error} onRetry={lib.refetch} />
    // Steam / PlayStation may still bring this view's games (a saved Steam
    // shelf, a queued PlayStation game): wait for them rather than say "empty".
    if (visible.length === 0 && lib.providersLoading) return <TgLoadingShelf />
    if (lib.games.length === 0) return <TgEmptyState kind="library" />
    if (visible.length === 0) return <TgEmptyState kind={search || pickedGenres.length ? 'filtered' : section === 'queue' ? 'queue' : 'section'} />
    const selId = selected?.id ?? null
    if (section === 'queue') {
      return <TgQueueView games={visible} ranks={ranks} selectedId={selId} onSelect={onSelect} fill={layout === 'desktop'} />
    }
    if (layout === 'mobile') return <TgMobileGrid games={visible} onSelect={onSelect} />
    if (view === 'grid') return <TgGridView games={visible} selectedId={selId} onSelect={onSelect} />
    if (view === 'list') return <TgListView games={visible} selectedId={selId} onSelect={onSelect} />
    return <TgShelf games={visible} selectedId={selId} onSelect={onSelect} />
  }

  function renderSection(layout: 'desktop' | 'mobile') {
    if (section === 'analytics') return <TgAnalyticsView />
    if (section === 'advanced') {
      return <TgAdvancedView onOpenDetail={actions.openFull} randomPool={visible} randomScope={{ platform: effectivePlatform, search, genres: pickedGenres }} />
    }
    return renderGames(layout)
  }

  const providerError = isGameSection && !lib.isError && lib.providerError != null
    ? <TgProviderError error={lib.providerError} onRetry={lib.retryProviders} />
    : null

  return (
    <>
      {bp === 'mobile' ? (
        <div key="phone" className="tg-root h-[100dvh] flex flex-col overflow-hidden">
          <TgMobileHeader platforms={counts} genres={genres} statusCounts={sCounts} header={header} />
          <div className="flex-1 min-h-0 tg-scroll-y pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] pt-2 pb-[calc(76px+env(safe-area-inset-bottom))]">
            {providerError}
            {renderSection('mobile')}
          </div>
          <TgBottomTabs counts={navCounts} />
        </div>
      ) : (
        <div key="wide" className="tg-root h-[100dvh] flex overflow-hidden">
          <TgSidebar counts={navCounts} platforms={shown} others={others} />
          <div className="relative flex-1 min-w-0 flex flex-col">
            <TgDetailOverlayBackdrop selected={selected} games={lib.games} />
            <TgTopBar
              genres={genres} statusCounts={sCounts} showStatus={section === 'library'}
              showViews={isGameSection && section !== 'queue'} showSort={isGameSection && section !== 'queue'}
              showSearch={isGameSection} showGenre={isGameSection}
            />
            <TgDetailOverlayHost
              game={detailGame} actions={actions} scroll={!isGameSection} pickRef={pickRef} panelRef={panelRef}
              header={<><TgHeader config={header} />{providerError}</>}
            >
              {renderSection('desktop')}
            </TgDetailOverlayHost>
          </div>
        </div>
      )}
      <TgModals
        bp={bp} actions={actions} sheetGame={collapsed ? null : detailGame} onCloseSheet={closeDetail}
        editId={editId} fullId={fullId} provider={provider} onClose={closeModal}
      />
    </>
  )
}
