import { useCallback, useMemo, useState } from 'react'
import './testGame.css'
import { useTestGameLibrary } from './useTestGameLibrary'
import { useTestGameStore } from './testGameStore'
import { useTgBreakpoint } from './useTgBreakpoint'
import { useTgHeaderConfig } from './useTgHeaderConfig'
import { useTgLibraryView } from './useTgLibraryView'
import { heroCandidates, type TgGame } from './testGameModel'
import type { TgActions } from './tgTypes'
import { TgSidebar } from './components/TgSidebar'
import { TgTopBar } from './components/TgTopBar'
import { TgHeader } from './components/TgHeader'
import { TgShelf } from './components/TgShelf'
import { TgGridView } from './components/TgGridView'
import { TgListView } from './components/TgListView'
import { TgDetailPanel } from './components/TgDetailPanel'
import { TgModals } from './components/TgModals'
import { TgMobileHeader, TgBottomTabs, TgMobileGrid } from './components/TgMobile'
import { TgQueueView } from './components/TgQueueView'
import { TgAnalyticsView } from './components/TgAnalyticsView'
import { TgAdvancedView } from './components/TgAdvancedView'
import { TgEmptyState, TgLoadingShelf, TgErrorState, TgProviderError } from './components/TgStates'
import { firstLiveCover } from './components/coverCache'
import { useStableValue } from './components/useStableValue'

// ─────────────────────────────────────────────────────────────────────────────
//  /#/test-game — the Games page rebuilt on the "Game Library" design.
//
//  A TEST page: it lives outside the app shell (its own sidebar, top bar and
//  phone tab bar, exactly as the design draws them), reads and writes the SAME
//  Supabase tables through the SAME hooks as /#/games, and replaces nothing.
//  Features the design has no place for yet live under Advanced, reused
//  verbatim from the current page, to be brought in one at a time.
// ─────────────────────────────────────────────────────────────────────────────

export function TestGamePage() {
  const lib = useTestGameLibrary()
  const bp = useTgBreakpoint()
  const section = useTestGameStore(s => s.section)
  const genre = useTestGameStore(s => s.genre)
  const view = useTestGameStore(s => s.view)
  const search = useTestGameStore(s => s.search)
  const selectedId = useTestGameStore(s => s.selectedId)
  const select = useTestGameStore(s => s.select)

  const [editId, setEditId] = useState<string | null>(null)
  const [fullId, setFullId] = useState<string | null>(null)
  const [provider, setProvider] = useState<TgGame | null>(null)
  // Below desktop the detail opens as a sheet; desktop shows it permanently.
  // Widening to desktop closes the sheet, so narrowing back never reopens it
  // on a game picked long before.
  const [sheetId, setSheetId] = useState<string | null>(null)
  const [prevBp, setPrevBp] = useState(bp)
  if (bp !== prevBp) {
    setPrevBp(bp)
    if (bp === 'desktop') setSheetId(null)
  }

  const {
    counts, shown, others, effectivePlatform, isGameSection, genres, statusCounts: sCounts, visible, ranks, navCounts,
  } = useTgLibraryView(lib)

  const selected = useMemo(() => {
    if (!isGameSection) return null
    return visible.find(g => g.id === selectedId) ?? (bp === 'desktop' ? visible[0] ?? null : null)
  }, [visible, selectedId, bp, isGameSection])
  const sheetGame = useMemo(() => lib.games.find(g => g.id === sheetId) ?? null, [lib.games, sheetId])

  // Arrowing along the shelf passes a game every few frames; the full-size
  // backdrop follows only once the selection rests, and skips dead art.
  const backdropId = useStableValue(selected?.id ?? null, 250)
  const backdropGame = useMemo(() => lib.games.find(g => g.id === backdropId) ?? null, [lib.games, backdropId])
  const backdrop = isGameSection && backdropGame ? firstLiveCover(heroCandidates(backdropGame)) : null

  const header = useTgHeaderConfig({ games: lib.games, platform: effectivePlatform, statusCounts: sCounts, visibleCount: visible.length })

  // ── Actions ───────────────────────────────────────────────────────────────
  const actions: TgActions = useMemo(() => ({
    openEdit: (id) => setEditId(id),
    openFull: (id) => setFullId(id),
    openProvider: (g) => setProvider(g),
  }), [])
  const onSelect = useCallback((id: string) => {
    select(id)
    if (bp !== 'desktop') setSheetId(id)
  }, [select, bp])
  const closeSheet = useCallback(() => setSheetId(null), [])
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
    if (visible.length === 0) return <TgEmptyState kind={search || genre ? 'filtered' : section === 'queue' ? 'queue' : 'section'} />
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
      return <TgAdvancedView onOpenDetail={actions.openFull} randomPool={visible} randomScope={{ platform: effectivePlatform, search, genre }} />
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
          <div className="flex-1 min-h-0 tg-scroll-y pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-2 pb-[calc(76px+env(safe-area-inset-bottom))]">
            {providerError}
            {renderSection('mobile')}
          </div>
          <TgBottomTabs counts={navCounts} />
        </div>
      ) : (
        <div key="wide" className="tg-root h-[100dvh] flex overflow-hidden">
          <TgSidebar counts={navCounts} platforms={shown} others={others} />
          <div className="relative flex-1 min-w-0 flex flex-col">
            {backdrop && <div aria-hidden className="tg-backdrop" style={{ backgroundImage: `url("${backdrop}")` }} />}
            <TgTopBar
              genres={genres} statusCounts={sCounts} showStatus={section === 'library'}
              showViews={isGameSection && section !== 'queue'} showSort={isGameSection && section !== 'queue'}
              showSearch={isGameSection} showGenre={isGameSection}
            />
            {/* Right and bottom insets: a landscape phone's notch, an iPad's home indicator.
                The sidebar and the top bar pad for theirs. */}
            <div className="relative flex-1 min-h-0 flex gap-5 pl-5 pr-[max(1.25rem,env(safe-area-inset-right))] pb-[max(1.25rem,env(safe-area-inset-bottom))] xl:pl-6 xl:pr-[max(1.5rem,env(safe-area-inset-right))]">
              <main className="flex-1 min-w-0 flex flex-col">
                <TgHeader config={header} />
                {providerError}
                <div className={`flex-1 min-h-0 ${isGameSection ? '' : 'tg-scroll-y'}`}>{renderSection('desktop')}</div>
              </main>
              {bp === 'desktop' && isGameSection && (
                <aside className="w-[380px] 2xl:w-[420px] shrink-0 min-h-0 flex">
                  <TgDetailPanel game={selected} actions={actions} variant="panel" />
                </aside>
              )}
            </div>
          </div>
        </div>
      )}
      <TgModals
        bp={bp} actions={actions} sheetGame={sheetGame} onCloseSheet={closeSheet}
        editId={editId} fullId={fullId} provider={provider} onClose={closeModal}
      />
    </>
  )
}
