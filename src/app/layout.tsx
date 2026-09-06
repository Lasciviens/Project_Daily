import { useLayoutEffect, useState } from 'react'
import { Outlet, NavLink, useLocation, useNavigationType } from 'react-router-dom'
import { format, getISOWeek } from 'date-fns'
import { useQueryClient } from '@tanstack/react-query'
import {
  Home as HomeIcon, CalendarDays, Clapperboard, Briefcase, Dumbbell, FolderKanban, Gamepad2,
  MoreHorizontal, Code2, Search, Sparkles, ClipboardList, UtensilsCrossed, Star, type LucideIcon,
} from 'lucide-react'
import { useViewTransitionNav } from '../shared/hooks/useViewTransitionNav'
import { usePullToRefresh } from '../shared/hooks/usePullToRefresh'
import { DevRequestsDrawer } from '../features/devRequests/components/DevRequestsDrawer'
import { AIPanel } from '../features/ai/components/AIPanel'
import { CommandBar } from '../shared/components/CommandBar'
import { SettingsMenu } from '../shared/components/SettingsMenu'
import { Toaster } from '../shared/components/Toaster'
import { OfflineBanner } from '../shared/components/OfflineBanner'
import { Sheet } from '../shared/components/Sheet'
import { ListRow } from '../shared/components/ListRow'
import { useUIStore } from './store'

// Per-route mobile header title (#3) — the header shows the active page's name
// on phones (the logo wordmark is desktop-only), so hiding redundant in-page
// <h1>s on mobile doesn't lose the "where am I" cue.
const ROUTE_TITLES: Record<string, string> = {
  '/home': 'Home', '/daily': 'Personal', '/shop': 'Shop', '/recipes': 'Food',
  '/media': 'Media', '/work': 'Work', '/projects': 'Projects', '/training': 'Training',
  '/games': 'Games', '/wishes': 'Wishes', '/developer': 'Developer',
}

// Remembered scroll offsets per route (#7) — restored on a Back (POP) nav so
// returning to a list lands where you left it; forward navs still start at top.
const scrollPositions = new Map<string, number>()

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

  // Header depth-shadow (scrolled) + native hide-on-scroll (headerHidden) both
  // live in the UI store, fed by whichever container actually scrolls: <main>
  // here, OR PersonalLayout's inner scroller on /daily,/shop,/recipes (main
  // never scrolls there). The header slides up (translateY(-100%)) with a
  // matching negative margin so <main> fills the gap; max-sm: no-ops on desktop.
  const scrolled = useUIStore(s => s.chromeScrolled)
  const headerHidden = useUIStore(s => s.chromeHidden)
  const reportScroll = useUIStore(s => s.reportScroll)
  const resetChrome = useUIStore(s => s.resetChrome)

  // <main> is the app's scroll container (not the document — see the
  // app-shell notes in index.css/usePullToRefresh.ts), so react-router no
  // longer gets even the browser's default anywhere near scroll reset:
  // without this, switching tabs kept the previous page's scroll offset
  // (land on Home halfway down after scrolling Games). useLayoutEffect (runs
  // before paint) so a view transition's "new" snapshot is taken already
  // scrolled to top — no visible jump inside the animation.
  const { pathname } = useLocation()
  const navType = useNavigationType()
  useLayoutEffect(() => {
    // Restore the remembered offset on Back; otherwise start the new page at top.
    const el = pullToRefresh.containerProps.ref.current
    const saved = scrollPositions.get(pathname)
    if (navType === 'POP' && saved != null && el) el.scrollTo({ top: saved })
    else el?.scrollTo({ top: 0 })
    resetChrome() // header visible + shadow cleared on each new route (store action, not setState)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // View Transitions (the directional tab slide) don't exist on pre-18 iOS
  // Safari — there, navigation was INSTANT, i.e. "no animations at all" on
  // exactly the device this app is used on most. Keying this wrapper by
  // pathname replays the .page-in rise on every route change as a universal
  // fallback. When VT IS supported the key stays constant (no double
  // animation — the VT slide owns the transition instead).
  const supportsVT = typeof document.startViewTransition === 'function'

  return (
    <div className="h-full flex flex-col bg-canvas overflow-hidden">
      <Nav scrolled={scrolled} collapsed={headerHidden} />
      <main
        className="flex-1 min-h-0 overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-0 relative"
        onScroll={e => { const y = (e.target as HTMLElement).scrollTop; reportScroll(y); scrollPositions.set(pathname, y) }}
        {...pullToRefresh.containerProps}
      >
        <PullToRefreshIndicator
          pullDistance={pullToRefresh.pullDistance}
          isRefreshing={pullToRefresh.isRefreshing}
          isReady={pullToRefresh.isReady}
        />
        {/* h-full ONLY on the Personal group — PersonalLayout/Shop size
            against main's content box via a percentage chain that needs a
            definite-height parent. Everywhere else the wrapper must stay
            auto-height: a fixed h-full box that tall pages overflow would
            swallow main's bottom padding (content runs over the padding
            zone), leaving the last card pinned under the floating tab bar.
            page-in only animates on non-VT engines, so its transform never
            disturbs fixed-position children on modern browsers. */}
        <div
          key={supportsVT ? 'static' : pathname}
          className={[
            ['/daily', '/shop', '/recipes'].includes(pathname) ? 'h-full' : '',
            supportsVT ? '' : 'page-in',
          ].filter(Boolean).join(' ') || undefined}
        >
          <Outlet />
        </div>
      </main>
      <BottomTabBar />
      <DevRequestsDrawer />
      <AIPanel />
      <CommandBar />
      <Toaster />
      <OfflineBanner />
    </div>
  )
}

// ─── Pull-to-refresh indicator ──────────────────────────────────────────────
// Mobile only (sm:hidden — pull gestures never fire from desktop mouse input
// anyway, this just also hides the dot visually). Follows the finger with a
// rotation cue, flips to solid accent once the release threshold is crossed
// (isReady — "letting go now will refresh"), spins while the refetch is
// actually in flight.
function PullToRefreshIndicator({ pullDistance, isRefreshing, isReady }: {
  pullDistance: number
  isRefreshing: boolean
  isReady: boolean
}) {
  return (
    <div
      className={`sm:hidden fixed left-1/2 -translate-x-1/2 z-30 flex items-center justify-center w-9 h-9 rounded-full shadow-md border transition-[transform,background-color,color] duration-150 ${
        isReady || isRefreshing
          ? 'bg-accent-500 border-accent-500 text-white'
          : 'glass-chrome border-ink-200/60 text-accent-600'
      }`}
      style={{
        top: 'calc(48px + env(safe-area-inset-top))',
        opacity: pullDistance > 4 || isRefreshing ? 1 : 0,
        transform: `translate(-50%, ${Math.max(pullDistance, isRefreshing ? 44 : 0) - 36}px) scale(${isRefreshing ? 1 : Math.min(0.6 + pullDistance / 88, 1.05)})`,
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
// Mobile bottom bar: 5 PRIMARY tabs (user-chosen; Food is a pinned top-level
// destination now) + a "More" cell. The rest (Work/Projects/Games/Developer)
// live in a bottom-sheet. Personal is Daily ONLY now; Food (which also holds
// Shop) is its own tab.
const TABS: { to: string; label: string; icon: LucideIcon; match: string[] }[] = [
  { to: '/home',     label: 'Home',     icon: HomeIcon,        match: ['/home'] },
  { to: '/daily',    label: 'Personal', icon: CalendarDays,    match: ['/daily'] },
  { to: '/recipes',  label: 'Food',     icon: UtensilsCrossed, match: ['/recipes', '/shop'] },
  { to: '/media',    label: 'Media',    icon: Clapperboard,    match: ['/media'] },
  { to: '/training', label: 'Training', icon: Dumbbell,        match: ['/training'] },
]
const MORE_TABS: { to: string; label: string; icon: LucideIcon; match: string[] }[] = [
  // Wishes leads the sheet on purpose: the whole point of a wish list is that
  // it surfaces without being hunted for, and the 5 primary slots are taken.
  { to: '/wishes',    label: 'Wishes',    icon: Star,         match: ['/wishes'] },
  { to: '/work',      label: 'Work',      icon: Briefcase,    match: ['/work'] },
  { to: '/projects',  label: 'Projects',  icon: FolderKanban, match: ['/projects'] },
  { to: '/games',     label: 'Games',     icon: Gamepad2,     match: ['/games'] },
  { to: '/developer', label: 'Developer', icon: Code2,        match: ['/developer'] },
]

function BottomTabBar() {
  const location = useLocation()
  const navigateWithTransition = useViewTransitionNav()
  const [moreOpen, setMoreOpen] = useState(false)
  const activeIndex = TABS.findIndex(tab => tab.match.includes(location.pathname))
  const moreActive = MORE_TABS.some(t => t.match.includes(location.pathname))

  // Floating glass capsule (detached from the screen edge, heavy blur, big
  // soft shadow) — the current-gen iOS tab-bar look, visibly more "app" than
  // a full-width bar glued to the bottom. Sits above the home indicator via
  // the safe-area offset; <main> reserves matching bottom padding.
  return (
    <>
    <nav className="vt-pin-tabbar glass-chrome sm:hidden fixed z-40 left-3 right-3 bottom-[calc(env(safe-area-inset-bottom)+0.625rem)] flex items-stretch rounded-[26px] border border-ink-200/60 select-none overflow-hidden shadow-[0_10px_32px_-6px_rgba(0,0,0,0.28)]">
      {TABS.map((tab, index) => {
        const isActive = index === activeIndex
        const Icon = tab.icon
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            onClick={e => {
              // View Transitions API slides the page toward the tapped tab
              // (see useViewTransitionNav + index.css) — falls back to the
              // keyed .page-in rise on browsers without the API (pre-iOS-18
              // Safari). Direction = tab order: tapping a tab to the RIGHT
              // of the current one slides content in from the right, and
              // vice versa, matching how native tab bars communicate it.
              e.preventDefault()
              // Re-tapping the ALREADY-active tab scrolls its page back to the
              // top (and the hide-on-scroll header slides back in) — the
              // standard iOS/Android tab-bar gesture — instead of a no-op nav.
              if (isActive) {
                document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
                return
              }
              navigateWithTransition(tab.to, activeIndex >= 0 && index < activeIndex ? 'back' : 'forward')
            }}
            className={`flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors duration-150 press-feedback ${
              isActive ? 'text-accent-600' : 'text-ink-400'
            }`}
          >
            {/* Active icon sits in a soft accent chip; animate-tabPop replays
                its once-off bounce each time this tab becomes the active one. */}
            <span className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 transition-colors duration-200 ${
              isActive ? 'bg-accent-500/15 animate-tabPop' : ''
            }`}>
              <Icon size={21} strokeWidth={isActive ? 2.25 : 1.75} fill={isActive ? 'currentColor' : 'none'} fillOpacity={isActive ? 0.15 : 0} />
            </span>
            <span className={`text-[10px] leading-none ${isActive ? 'font-semibold' : 'font-medium'}`}>{tab.label}</span>
          </NavLink>
        )
      })}
      {/* "More" — opens a bottom sheet with the secondary destinations
          (Work / Projects / Games / Developer) so the primary bar stays 4-up. */}
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        className={`flex-1 min-h-[52px] flex flex-col items-center justify-center gap-0.5 py-1.5 transition-colors duration-150 press-feedback ${moreActive ? 'text-accent-600' : 'text-ink-400'}`}
      >
        <span className={`inline-flex items-center justify-center rounded-full px-2.5 py-0.5 transition-colors duration-200 ${moreActive ? 'bg-accent-500/15' : ''}`}>
          <MoreHorizontal size={21} strokeWidth={moreActive ? 2.25 : 1.75} />
        </span>
        <span className={`text-[10px] leading-none ${moreActive ? 'font-semibold' : 'font-medium'}`}>More</span>
      </button>
    </nav>
    <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More" size="sm">
      <div className="p-2 flex flex-col gap-0.5">
        {MORE_TABS.map(tab => {
          const Icon = tab.icon
          const active = tab.match.includes(location.pathname)
          return (
            <NavLink key={tab.to} to={tab.to} onClick={() => setMoreOpen(false)}>
              <ListRow
                leading={<Icon size={20} className={active ? 'text-accent-600' : 'text-ink-500'} />}
                title={<span className={active ? 'text-accent-700 font-semibold' : 'text-ink-800'}>{tab.label}</span>}
                trailing={active ? <span className="text-accent-500 text-xs">●</span> : undefined}
              />
            </NavLink>
          )
        })}
      </div>
    </Sheet>
    </>
  )
}

// "Food" groups Food (/recipes) + Shop (/shop) under one nav entry — a single
// link to /recipes, active on either; FoodTabs (in each page's header) switches
// between them. Personal is now just Daily (a plain link in the nav row).
function FoodNavLink() {
  const location = useLocation()
  const isActive = ['/recipes', '/shop'].includes(location.pathname)

  return (
    <NavLink
      to="/recipes"
      className={`px-3 py-2.5 min-h-[44px] inline-flex items-center text-sm font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
        isActive ? 'bg-accent-500 text-white' : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
      }`}
    >
      Food
    </NavLink>
  )
}

function Nav({ scrolled, collapsed }: { scrolled: boolean; collapsed: boolean }) {
  const { isDevRequestsOpen, toggleDevRequests, isAIOpen, toggleAI, openCommandBar } = useUIStore()
  const { pathname } = useLocation()
  const pageTitle = ROUTE_TITLES[pathname] ?? ''

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2.5 min-h-[44px] inline-flex items-center text-sm font-medium rounded-lg transition-colors duration-150 whitespace-nowrap ${
      isActive
        ? 'bg-accent-500 text-white'
        : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
    }`

  return (
    // pt-[env(safe-area-inset-top)]: with apple-mobile-web-app-status-bar-style
    // "black-translucent" (index.html) the installed PWA draws edge-to-edge
    // under the iOS status bar — this padding keeps the header's content below
    // the clock/battery while the header's own background fills the gap, the
    // standard native-app look. 0 everywhere else (browser tabs, desktop).
    <header className={`vt-pin-header glass-chrome sticky top-0 z-40 border-b pt-[env(safe-area-inset-top)] transition-[box-shadow,border-color,transform,margin] duration-300 will-change-transform ${
      scrolled ? 'border-ink-200/80 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.28)]' : 'border-ink-200/40'
    } ${collapsed ? 'max-sm:-translate-y-full max-sm:mb-[calc(-3rem_-_env(safe-area-inset-top))]' : ''}`}>
      {/* The Settings button sits in its own unpadded sibling below so it can
          sit flush against the true right edge — everything else keeps the
          row's normal side padding. No overflow risk: this is a plain flex
          row (no overflow-x-auto), so removing the row's own right padding
          never introduces a scrollbar. */}
      <div className="w-full h-12 sm:h-14 flex items-center gap-1">
      <div className="flex-1 min-w-0 pl-4 sm:pl-6 lg:pl-8 flex items-center justify-between gap-2">
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Lasci's Board" className="w-7 h-7" />
          <span className="font-semibold text-ink-900 text-sm hidden sm:block">Lasci's Board</span>
          {/* #3 — active page name on mobile (logo wordmark is desktop-only) */}
          <span className="sm:hidden font-semibold text-ink-900 text-[15px] truncate">{pageTitle}</span>
        </div>

        {/* Nav links — below sm, this is replaced entirely by BottomTabBar
            (a fixed app-style tab bar), so hide this row rather than have
            two navigations. From sm+ this is the only nav (no bottom bar). */}
        <nav className="hidden sm:flex items-center gap-0.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
          <NavLink to="/home"      className={linkClass}>Home</NavLink>
          <NavLink to="/daily"     className={linkClass}>Personal</NavLink>
          <FoodNavLink />
          <NavLink to="/media"     className={linkClass}>Media</NavLink>
          <NavLink to="/work"      className={linkClass}>Work</NavLink>
          <NavLink to="/training"  className={linkClass}>Training</NavLink>
          <NavLink to="/projects"  className={linkClass}>Projects</NavLink>
          <NavLink to="/games"     className={linkClass}>Games</NavLink>
          {/* From sm+ this row is the ONLY nav (BottomTabBar is sm:hidden), so a
              destination that lives in the mobile More sheet still needs a link
              here or it is unreachable on desktop. */}
          <NavLink to="/wishes"    className={linkClass}>Wishes</NavLink>
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Today's date */}
          <span className="text-xs text-ink-400 hidden md:block mr-2">
            {format(new Date(), 'EEE, d MMM')} · W{getISOWeek(new Date())}
          </span>

          {/* ⌘K command bar trigger — global fuzzy task search / jump-to /
              quick-add. On mobile the ⌘K keyboard shortcut can't be typed and
              this was the ONLY trigger (previously hidden md:flex), so the
              whole command palette was unreachable on phones. Now icon-only
              below md (matching the ✦/🗒️ neighbours) so it's always reachable. */}
          <button
            onClick={openCommandBar}
            aria-label="Search"
            className="min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-100 transition-colors duration-150 flex items-center gap-1.5 md:border md:border-ink-200 flex-shrink-0"
          >
            <Search size={18} className="md:hidden" />
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden md:inline text-[10px] bg-ink-100 px-1 py-0.5 rounded">⌘K</kbd>
          </button>

          <button
            onClick={toggleAI}
            aria-label="Ask AI"
            className={`min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 flex items-center flex-shrink-0 ${
              isAIOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            <Sparkles size={18} className="sm:hidden" />
            <span className="hidden sm:inline">✦ Ask AI</span>
          </button>

          <button
            onClick={toggleDevRequests}
            aria-label="Dev requests"
            className={`min-h-[44px] px-3 py-1.5 text-xs font-medium rounded-lg transition-colors duration-150 flex items-center flex-shrink-0 ${
              isDevRequestsOpen
                ? 'bg-accent-50 text-accent-600'
                : 'text-ink-500 hover:text-ink-900 hover:bg-ink-100'
            }`}
          >
            <ClipboardList size={18} className="sm:hidden" />
            <span className="hidden sm:inline">🗒️ Requests</span>
          </button>
        </div>
      </div>
      {/* Flush against the true right edge — no right padding of its own. */}
      <div className="flex-shrink-0 pr-1">
        <SettingsMenu />
      </div>
      </div>
    </header>
  )
}
