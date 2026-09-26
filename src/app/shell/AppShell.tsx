import { useLayoutEffect } from 'react'
import { Outlet, useLocation, useNavigationType } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { usePullToRefresh } from '../../shared/hooks/usePullToRefresh'
import { useBreakpoint } from '../../shared/hooks/useBreakpoint'
import { DevRequestsDrawer } from '../../features/devRequests/components/DevRequestsDrawer'
import { AIPanel } from '../../features/ai/components/AIPanel'
import { CommandBar } from '../../shared/components/CommandBar'
import { Toaster } from '../../shared/components/Toaster'
import { OfflineBanner } from '../../shared/components/OfflineBanner'
import { ModalHost, useModalStore } from '../../shared/modals'
import { cx } from '../../shared/ui'
import { useUIStore } from '../store'
import { isFullHeightRoute } from '../navigation'
import { useAppBootstrap } from './useAppBootstrap'
import { AppSidebar } from './AppSidebar'
import { AppTopBar } from './AppTopBar'
import { MobileHeader } from './MobileHeader'
import { BottomTabBar } from './BottomTabBar'
import { PullToRefreshIndicator } from './PullToRefreshIndicator'

// Remembered scroll offsets per route — restored on a Back (POP) nav so
// returning to a list lands where you left it; forward navs start at top.
const scrollPositions = new Map<string, number>()

// Toasts clear the tab bar on phones; bottom-left of the content elsewhere.
const TOAST_POSITION = {
  phone: 'left-4 right-4 bottom-[calc(var(--app-tabbar-h)+env(safe-area-inset-bottom)+8px)]',
  tablet: 'bottom-6 left-[calc(68px+env(safe-area-inset-left)+16px)]',
  desktop: 'bottom-6 left-[calc(var(--app-sidebar-w)+env(safe-area-inset-left)+24px)]',
}

/**
 * The app frame (THEME.md §6): sidebar + top bar from 768px, phone header +
 * tab bar below. The document never scrolls — <main> is the ONE scroll
 * container, which is what keeps the custom pull-to-refresh reliable on iOS
 * (see usePullToRefresh.ts) and lets the glass chrome frost what scrolls
 * behind it.
 */
export function AppShell() {
  useAppBootstrap()
  const bp = useBreakpoint()
  const phone = bp === 'phone'

  // Pull down to refetch every query. dailyBriefing is excluded on purpose:
  // it is staleTime: Infinity to enforce "one AI briefing per day", and
  // invalidateQueries ignores staleTime — every pull used to cost an AI call.
  // The card's own refresh button stays the manual override.
  const qc = useQueryClient()
  const pullToRefresh = usePullToRefresh(() => qc.invalidateQueries({
    predicate: query => query.queryKey[0] !== 'dailyBriefing',
  }))

  const reportScroll = useUIStore(s => s.reportScroll)
  const resetChrome = useUIStore(s => s.resetChrome)

  // <main> scrolls, not the document, so react-router's scroll handling never
  // applies: without this a new page kept the previous page's offset.
  // Layout effect (pre-paint) so a view transition's "new" snapshot is taken
  // already at the right offset. A route change also closes every entity
  // popup — one opened on a page must never linger over another.
  const { pathname } = useLocation()
  const navType = useNavigationType()
  useLayoutEffect(() => {
    const el = pullToRefresh.containerProps.ref.current
    const saved = scrollPositions.get(pathname)
    if (navType === 'POP' && saved != null && el) el.scrollTo({ top: saved })
    else el?.scrollTo({ top: 0 })
    resetChrome()
    useModalStore.getState().closeAll()
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // Without View Transitions (pre-18 iOS Safari, the primary device) route
  // changes would be instant; keying the wrapper by pathname replays the
  // .page-in rise instead. With VT the key stays constant (no double animation).
  const supportsVT = typeof document.startViewTransition === 'function'
  // Only a page that sizes itself against <main> (Shop's two panes) gets a
  // definite height. Everywhere else the wrapper must stay auto-height, or a
  // tall page overflows it and runs over <main>'s bottom padding — the last
  // card then sits under the phone tab bar.
  const fullHeight = isFullHeightRoute(pathname)

  const main = (
    <main
      data-app-scroller
      className={cx(
        'relative min-h-0 flex-1 overflow-y-auto overscroll-y-contain',
        phone && 'pb-[calc(var(--app-tabbar-h)+env(safe-area-inset-bottom)+16px)]',
      )}
      onScroll={e => { const y = (e.target as HTMLElement).scrollTop; reportScroll(y); scrollPositions.set(pathname, y) }}
      {...pullToRefresh.containerProps}
    >
      {phone && (
        <PullToRefreshIndicator
          pullDistance={pullToRefresh.pullDistance}
          isRefreshing={pullToRefresh.isRefreshing}
          isReady={pullToRefresh.isReady}
        />
      )}
      <div key={supportsVT ? 'static' : pathname} className={cx(fullHeight && 'h-full', !supportsVT && 'page-in') || undefined}>
        <Outlet />
      </div>
    </main>
  )

  // One tree for every breakpoint (only the chrome swaps), so <main> and the
  // page inside it survive a rotation or a window resize.
  return (
    <div className="flex h-full overflow-hidden bg-canvas">
      {!phone && <AppSidebar rail={bp === 'tablet'} />}
      <div className="flex min-w-0 flex-1 flex-col">
        {phone ? <MobileHeader /> : <AppTopBar />}
        {main}
      </div>
      {phone && <BottomTabBar />}
      <DevRequestsDrawer />
      <AIPanel />
      <CommandBar />
      <ModalHost />
      <Toaster positionClassName={TOAST_POSITION[bp]} />
      <OfflineBanner />
    </div>
  )
}
