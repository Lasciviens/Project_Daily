import { useCallback, useMemo, useState } from 'react'
import './testGame.css'
import { Toaster } from '../../../shared/components/Toaster'
import { ErrorBoundary } from '../../../shared/components/ErrorBoundary'
import { GameDetailModal } from '../components/GameDetailModal'
import { SteamGameModal } from '../components/SteamGameModal'
import { PsnGameModal } from '../components/PsnGameModal'
import type { SteamGame } from '../api/steamApi'
import { psnGamesFromLibrary } from '../api/psnLibraryFallback'
import { useTestGameLibrary } from './useTestGameLibrary'
import { useTestGameStore, type AdvancedTab } from './testGameStore'
import { useTgBreakpoint } from './useTgBreakpoint'
import {
  ALL_PLATFORMS, OTHER_PLATFORMS, STATUS_SECTIONS, STATUS_TABS, STATUS_TEXT,
  applyStatus, genreOptions, heroCandidates, platformCounts, platformInfo, queueOrder,
  scopeGames, sortGames, splitPlatforms, statusCounts,
  type TgGame, type TgSection,
} from './testGameModel'
import type { TgActions, TgHeaderConfig } from './tgTypes'
import { TgSidebar } from './components/TgSidebar'
import { TgTopBar } from './components/TgTopBar'
import { TgHeader } from './components/TgHeader'
import { TgShelf } from './components/TgShelf'
import { TgGridView } from './components/TgGridView'
import { TgListView } from './components/TgListView'
import { TgDetailPanel } from './components/TgDetailPanel'
import { TgDetailSheet } from './components/TgDetailSheet'
import { TgMobileHeader, TgBottomTabs, TgMobileGrid } from './components/TgMobile'
import { TgQueueView } from './components/TgQueueView'
import { TgAnalyticsView } from './components/TgAnalyticsView'
import { TgAdvancedView } from './components/TgAdvancedView'
import { ADVANCED_TABS } from './advancedTabs'
import { TgEmptyState, TgLoadingShelf, TgErrorState } from './components/TgStates'

// ─────────────────────────────────────────────────────────────────────────────
//  /#/test-game — the Games page rebuilt on the "Game Library" design.
//
//  A TEST page: it lives outside the app shell (its own sidebar, top bar and
//  phone tab bar, exactly as the design draws them), reads and writes the SAME
//  Supabase tables through the SAME hooks as /#/games, and replaces nothing.
//  Features the design has no place for yet live under Advanced, reused
//  verbatim from the current page, to be brought in one at a time.
// ─────────────────────────────────────────────────────────────────────────────

const SECTION_TITLE: Record<TgSection, string> = {
  library: 'Library', queue: 'Play Queue', wishlist: 'Wishlist', completed: 'Completed',
  backlog: 'Backlog', analytics: 'Analytics', advanced: 'Advanced',
}

function plural(n: number, word: string) { return `${n} ${word}${n === 1 ? '' : 's'}` }

/** A saved library row, shaped as the live Steam payload the modal expects. */
function toSteamGame(g: TgGame): SteamGame {
  const last = g.last_played_at ? Math.floor(Date.parse(g.last_played_at) / 1000) : undefined
  return {
    appid: g.steamAppId ?? 0,
    name: g.title,
    playtime_forever: Math.round((g.play_seconds ?? 0) / 60),
    rtime_last_played: Number.isFinite(last) ? last : undefined,
  }
}

export function TestGamePage() {
  const lib = useTestGameLibrary()
  const bp = useTgBreakpoint()
  const {
    section, platform, scopePlatform, status, genre, sort, view, search, selectedId, advancedTab,
    select, setStatus, setScopePlatform, setAdvancedTab,
  } = useTestGameStore()

  const [editId, setEditId] = useState<string | null>(null)
  const [fullId, setFullId] = useState<string | null>(null)
  const [provider, setProvider] = useState<TgGame | null>(null)
  // Tablet and phone open the detail as a sheet; desktop shows it permanently.
  const [sheetId, setSheetId] = useState<string | null>(null)

  // ── Derived data ──────────────────────────────────────────────────────────
  const counts = useMemo(() => platformCounts(lib.games), [lib.games])
  const { shown, others } = useMemo(() => splitPlatforms(counts, 8), [counts])
  const otherKeys = useMemo(() => others.map(o => o.key), [others])

  // A persisted platform that no longer has games (renamed system, emptied
  // library) would pin the page to an empty shelf — fall back to everything.
  const effectivePlatform = useMemo(() => {
    if (platform === ALL_PLATFORMS) return ALL_PLATFORMS
    if (platform === OTHER_PLATFORMS) return others.length ? OTHER_PLATFORMS : ALL_PLATFORMS
    return counts.some(c => c.key === platform) || lib.isLoading ? platform : ALL_PLATFORMS
  }, [platform, others.length, counts, lib.isLoading])

  const fixedStatus = STATUS_SECTIONS[section]
  const scopeBase = { section, platform: effectivePlatform, otherKeys, scopePlatform, search }
  const scope = useMemo(
    () => scopeGames(lib.games, { ...scopeBase, genre }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lib.games, section, effectivePlatform, otherKeys, scopePlatform, search, genre],
  )
  const genres = useMemo(
    () => genreOptions(scopeGames(lib.games, { ...scopeBase, genre: null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lib.games, section, effectivePlatform, otherKeys, scopePlatform, search],
  )
  const sCounts = useMemo(() => statusCounts(scope), [scope])

  const visible = useMemo(() => {
    if (section === 'queue') return queueOrder(applyStatus(scope, 'all'))
    return sortGames(applyStatus(scope, fixedStatus ? 'all' : status), sort)
  }, [scope, section, fixedStatus, status, sort])

  const navCounts = useMemo(() => {
    const all = statusCounts(lib.games)
    return {
      queue: lib.games.filter(g => g.play_order != null).length,
      wishlist: all.wishlist, completed: all.completed, backlog: all.backlog,
    }
  }, [lib.games])

  const isGameSection = section !== 'analytics' && section !== 'advanced'
  const selected = useMemo(() => {
    if (!isGameSection) return null
    return visible.find(g => g.id === selectedId) ?? (bp === 'desktop' ? visible[0] ?? null : null)
  }, [visible, selectedId, bp, isGameSection])
  const sheetGame = useMemo(() => lib.games.find(g => g.id === sheetId) ?? null, [lib.games, sheetId])

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

  // ── Header ────────────────────────────────────────────────────────────────
  const header: TgHeaderConfig = useMemo(() => {
    if (section === 'library') {
      const info = platformInfo(effectivePlatform)
      return {
        title: info.name,
        subtitle: plural(sCounts.all, 'game'),
        logo: effectivePlatform === ALL_PLATFORMS ? 'all' : effectivePlatform === OTHER_PLATFORMS ? 'others' : 'platform',
        platformKey: effectivePlatform,
        tabs: STATUS_TABS.map(s => ({ key: s, label: STATUS_TEXT[s], count: sCounts[s] })),
        activeTab: STATUS_TABS.includes(status) ? status : null,
        onTab: (k) => setStatus(k as typeof status),
      }
    }
    if (fixedStatus) {
      const inStatus = lib.games.filter(g => !g.hidden && g.play_status === fixedStatus)
      const byPlatform = platformCounts(inStatus)
      return {
        title: SECTION_TITLE[section],
        subtitle: `${plural(inStatus.length, 'game')} across ${plural(byPlatform.length, 'platform')}`,
        logo: section as TgHeaderConfig['logo'],
        tabs: [
          { key: ALL_PLATFORMS, label: 'All', count: inStatus.length },
          ...byPlatform.map(p => ({ key: p.key, label: p.info.short, count: p.count })),
        ],
        activeTab: scopePlatform,
        onTab: setScopePlatform,
      }
    }
    if (section === 'queue') {
      return { title: 'Play Queue', subtitle: `${plural(visible.length, 'game')} · in play order`, logo: 'queue', tabs: [], activeTab: null }
    }
    if (section === 'analytics') {
      return { title: 'Analytics', subtitle: 'Your library in numbers', logo: 'analytics', tabs: [], activeTab: null }
    }
    return {
      title: 'Advanced',
      subtitle: 'Everything from the current Games page the new design has no place for yet',
      logo: 'advanced',
      tabs: ADVANCED_TABS.map(t => ({ key: t.key, label: t.label })),
      activeTab: advancedTab,
      onTab: (k) => setAdvancedTab(k as AdvancedTab),
    }
  }, [section, effectivePlatform, sCounts, status, fixedStatus, lib.games, scopePlatform, visible.length,
      advancedTab, setStatus, setScopePlatform, setAdvancedTab])

  // ── Content ───────────────────────────────────────────────────────────────
  function renderGames(layout: 'desktop' | 'mobile') {
    if (lib.isLoading) return <TgLoadingShelf />
    if (lib.isError) return <TgErrorState error={lib.error} onRetry={lib.refetch} />
    if (lib.games.length === 0) return <TgEmptyState kind="library" />
    if (visible.length === 0) return <TgEmptyState kind={search || genre ? 'filtered' : section === 'queue' ? 'queue' : 'section'} />
    if (section === 'queue') return <TgQueueView games={visible} selectedId={selected?.id ?? null} onSelect={onSelect} />
    if (layout === 'mobile') return <TgMobileGrid games={visible} onSelect={onSelect} />
    if (view === 'grid') return <TgGridView games={visible} selectedId={selected?.id ?? null} onSelect={onSelect} />
    if (view === 'list') return <TgListView games={visible} selectedId={selected?.id ?? null} onSelect={onSelect} />
    return <TgShelf games={visible} selectedId={selected?.id ?? null} onSelect={onSelect} />
  }

  function renderSection(layout: 'desktop' | 'mobile') {
    if (section === 'analytics') return <TgAnalyticsView />
    if (section === 'advanced') return <TgAdvancedView onOpenDetail={actions.openFull} randomPool={visible} />
    return renderGames(layout)
  }

  const backdrop = selected ? heroCandidates(selected)[0] ?? null : null

  const modals = (
    <>
      {editId && <GameDetailModal gameId={editId} initialEditing onClose={() => setEditId(null)} />}
      {fullId && <GameDetailModal gameId={fullId} onClose={() => setFullId(null)} />}
      {provider?.library === 'steam' && provider.steamAppId != null && (
        <ErrorBoundary label="Steam" action="test_game_steam_modal">
          <SteamGameModal game={toSteamGame(provider)} onClose={() => setProvider(null)} />
        </ErrorBoundary>
      )}
      {provider?.library === 'playstation' && (
        <ErrorBoundary label="PlayStation" action="test_game_psn_modal">
          <PsnGameModal game={psnGamesFromLibrary([provider])[0]} onClose={() => setProvider(null)} />
        </ErrorBoundary>
      )}
      <Toaster />
    </>
  )

  // ── Phone ─────────────────────────────────────────────────────────────────
  if (bp === 'mobile') {
    return (
      <div className="tg-root h-[100dvh] flex flex-col overflow-hidden">
        <TgMobileHeader platforms={counts} genres={genres} statusCounts={sCounts} header={header} />
        <div className="flex-1 min-h-0 tg-scroll-y px-4 pt-2 pb-[calc(76px+env(safe-area-inset-bottom))]">
          {renderSection('mobile')}
        </div>
        <TgBottomTabs counts={navCounts} />
        <TgDetailSheet game={sheetGame} variant="fullscreen" actions={actions} onClose={() => setSheetId(null)} />
        {modals}
      </div>
    )
  }

  // ── Tablet & desktop ──────────────────────────────────────────────────────
  const showPanel = bp === 'desktop' && isGameSection
  return (
    <div className="tg-root h-[100dvh] flex overflow-hidden">
      <TgSidebar counts={navCounts} platforms={shown} others={others} />

      <div className="relative flex-1 min-w-0 flex flex-col">
        {backdrop && isGameSection && (
          <div aria-hidden className="tg-backdrop" style={{ backgroundImage: `url("${backdrop}")` }} />
        )}
        <TgTopBar genres={genres} statusCounts={sCounts} showStatus={section === 'library'} showViews={isGameSection && section !== 'queue'} />

        <div className="relative flex-1 min-h-0 flex gap-5 px-5 xl:px-6 pb-5">
          <main className="flex-1 min-w-0 flex flex-col">
            <TgHeader config={header} />
            <div className={`flex-1 min-h-0 ${isGameSection ? '' : 'tg-scroll-y'}`}>
              {renderSection('desktop')}
            </div>
          </main>

          {showPanel && (
            <aside className="w-[380px] 2xl:w-[420px] shrink-0 min-h-0 flex">
              <TgDetailPanel game={selected} actions={actions} variant="panel" />
            </aside>
          )}
        </div>
      </div>

      {bp === 'tablet' && (
        <TgDetailSheet game={sheetGame} variant="drawer" actions={actions} onClose={() => setSheetId(null)} />
      )}
      {modals}
    </div>
  )
}
