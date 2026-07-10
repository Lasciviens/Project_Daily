import { Outlet, NavLink, useLocation } from 'react-router-dom'
import { format, getISOWeek } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import {
  Home as HomeIcon, CalendarDays, Clapperboard, Briefcase, Dumbbell, FolderKanban, Gamepad2,
  type LucideIcon,
} from 'lucide-react'
import { useViewTransitionNav } from '../shared/hooks/useViewTransitionNav'
import { usePullToRefresh } from '../shared/hooks/usePullToRefresh'
import { DevRequestsDrawer } from '../features/devRequests/components/DevRequestsDrawer'
import { AIPanel } from '../features/ai/components/AIPanel'
import { CommandBar } from '../shared/components/CommandBar'
import { SettingsMenu } from '../shared/components/SettingsMenu'
import { Toaster } from '../shared/components/Toaster'
import { useUIStore } from './store'

export function Layout() {
  // Lives here (the shell every route renders inside), not on individual
  // pages — a hook called once at this level applies to every route
  // automatically, instead of every page needing to call it separately.
  // Every page's queries get invalidated on refresh regardless of which
  // route is active — simplest match for "pull down, everything re-syncs"
  // without threading a page-specific refetch list through this component.
  //
  // dailyBriefing is excluded on purpose: useDailyBriefing.ts sets
  // staleTime: Infinity specifically to enforce "generate at most once per
  // day" (it costs a real AI call) — but invalidateQueries() ignores
  // staleTime entirely and force-refetches anyway, which silently defeated
  // that once-a-day design every time pull-to-refresh ran (the extra AI
  // call is exactly why a refresh felt like it took noticeably longer).
  // The card's own ↻ button is still the explicit manual override for it.
  const qc = useQueryClient()
  const pullToRefresh = usePullToRefresh(() => qc.invalidateQueries({
    predicate: query => query.queryKey[0] !== 'dailyBriefing',
  }))

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <Nav />
      <main
        className="flex-1 pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0 relative"
        {...pullToRefresh.containerProps}
      >
        <PullToRefreshIndicator pullDistance={pullToRefresh.pullDistance} isRefreshing={pullToRefresh.isRefreshing} />
        <Outlet />
      </main>
      <BottomTabBar />
      <DevRequestsDrawer />
      <AIPanel />
      <CommandBar />
      <Toaster />
    </div>
  )
}

// ─── Pull-to-refresh indicator ──────────────────────────────────────────────
// Mobile only (sm:hidden — pull gestures never fire from desktop mouse input
// anyway, this just also hides the dot visually). Grows with pull distance,
// spins in place once the refresh threshold is crossed and a refetch is
// actually in flight.
function PullToRefreshIndicator({ pullDistance, isRefreshing }: { pullDistance: number; isRefreshing: boolean }) {
  return (
    <div
      className="sm:hidden fixed left-1/2 -translate-x-1/2 z-30 flex items-center justify-center w-9 h-9 rounded-full bg-white shadow-md border border-ink-200 text-accent-600 transition-transform"
      style={{
        top: '56px',
        opacity: pullDistance > 4 || isRefreshing ? 1 : 0,
        transform: `translate(-50%, ${Math.max(pullDistance, isRefreshing ? 44 : 0) - 36}px)`,
      }}
    >
      <span className={isRefreshing ? 'animate-spin' : ''} style={{
        transform: isRefreshing ? undefined : `rotate(${pullDistance * 3}deg)`,
      }}>↻</span>
    </div>
  )
}

// ─── Mobile bottom tab bar ──────────────────────────────────────────────────
// Below sm (640px) the old horizontal top nav is hidden in favor of this —
// a real app-style fixed tab bar reads immediately as "this is an app", and
// (the actual bug it fixes) sidesteps the scrollable top nav's stuck-scroll-
// position problem: that nav never resets `scrollLeft` between route changes
// and has no scroll affordance, so once a user scrolled right to reach
// Training/Projects/Games, Home/Personal/Media/Work looked like they'd
// vanished. All 7 destinations are always-visible, equal-width, no scrolling.
// Lucide (outline SVG icons), not emoji — emoji glyphs render inconsistently
// across OS/browser font versions and read as dated rather than "native app"
// polish; a single crisp icon set that recolors/fills on the active tab is
// the modern-iOS-tab-bar look this is going for.
const TABS: { to: string; label: string; icon: LucideIcon; match: string[] }[] = [
  { to: '/home',     label: 'Home',     icon: HomeIcon,     match: ['/home'] },
  { to: '/daily',    label: 'Personal', icon: CalendarDays, match: ['/daily', '/shop', '/recipes'] },
  { to: '/media',    label: 'Media',    icon: Clapperboard, match: ['/media'] },
  { to: '/work',     label: 'Work',     icon: Briefcase,    match: ['/work'] },
  { to: '/training', label: 'Training', icon: Dumbbell,     match: ['/training'] },
  { to: '/projects', label: 'Projects', icon: FolderKanban, match: ['/projects'] },
  { to: '/games',    label: 'Games',    icon: Gamepad2,      match: ['/games'] },
]

function BottomTabBar() {
  const location = useLocation()
  const navigateWithTransition = useViewTransitionNav()

  return (
    <nav className="sm:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch bg-white/95 backdrop-blur-lg border-t border-ink-200 pb-[env(safe-area-inset-bottom)]">
      {TABS.map(tab => {
        const isActive = tab.match.includes(location.pathname)
        const Icon = tab.icon
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            onClick={e => {
              // View Transitions API gives a native-feeling crossfade between
              // tabs (see useViewTransitionNav) — no-ops to a plain navigation
              // on browsers that don't support it (pre-iOS-18 Safari etc).
              e.preventDefault()
              navigateWithTransition(tab.to)
            }}
            className={`flex-1 min-h-[56px] flex flex-col items-center justify-center gap-0.5 transition-colors duration-150 press-feedback ${
              isActive ? 'text-accent-600' : 'text-ink-400'
            }`}
          >
            <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} fill={isActive ? 'currentColor' : 'none'} fillOpacity={isActive ? 0.15 : 0} />
            <span className={`text-[10px] leading-none ${isActive ? 'font-semibold' : 'font-medium'}`}>{tab.label}</span>
          </NavLink>
        )
      })}
    </nav>
  )
}

// "Personal" groups the personal-life sub-pages (Daily, Shop, Recipes) under
// one nav entry. It's a single link to /daily — PersonalLayout renders a
// Work-style tab bar there for switching between the three (see
// src/features/personal/components/PersonalLayout.tsx).
function PersonalNavLink() {
  const location = useLocation()
  const isActive = ['/daily', '/shop', '/recipes'].includes(location.pathname)

  return (
    <NavLink
      to="/daily"
      className={`px-3 py-2.5 min-h-[44px] inline-flex items-center text-sm font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
        isActive ? 'bg-accent-500 text-white' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
      }`}
    >
      Personal
    </NavLink>
  )
}

function Nav() {
  const { isDevRequestsOpen, toggleDevRequests, isAIOpen, toggleAI, openCommandBar } = useUIStore()

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2.5 min-h-[44px] inline-flex items-center text-sm font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
      isActive
        ? 'bg-accent-500 text-white'
        : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
    }`

  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-ink-200">
      <div className="w-full px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-2">
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Lasci's Board" className="w-7 h-7" />
          <span className="font-semibold text-ink-900 text-sm hidden sm:block">Lasci's Board</span>
        </div>

        {/* Nav links — below sm, this is replaced entirely by BottomTabBar
            (a fixed app-style tab bar), so hide this row rather than have
            two navigations. From sm+ this is the only nav (no bottom bar). */}
        <nav className="hidden sm:flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
          <NavLink to="/home"      className={linkClass}>Home</NavLink>
          <PersonalNavLink />
          <NavLink to="/media"     className={linkClass}>Media</NavLink>
          <NavLink to="/work"      className={linkClass}>Work</NavLink>
          <NavLink to="/training"  className={linkClass}>Training</NavLink>
          <NavLink to="/projects"  className={linkClass}>Projects</NavLink>
          <NavLink to="/games"     className={linkClass}>Games</NavLink>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Today's date */}
          <span className="text-xs text-ink-400 hidden md:block mr-2">
            {format(new Date(), 'EEE, d MMM')} · W{getISOWeek(new Date())}
          </span>

          {/* ⌘K command bar trigger */}
          <button
            onClick={openCommandBar}
            className="min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors duration-150 hidden md:flex items-center gap-1.5 border border-ink-200"
          >
            <span>Search</span>
            <kbd className="text-[10px] bg-ink-100 px-1 py-0.5 rounded">⌘K</kbd>
          </button>

          <button
            onClick={toggleAI}
            className={`min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 hidden sm:flex items-center ${
              isAIOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            ✦ Ask AI
          </button>

          <button
            onClick={toggleDevRequests}
            className={`min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 flex items-center flex-shrink-0 ${
              isDevRequestsOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            <span className="sm:hidden">🗒️</span>
            <span className="hidden sm:inline">🗒️ Requests</span>
          </button>

          <SettingsMenu />
        </div>
      </div>
    </header>
  )
}
