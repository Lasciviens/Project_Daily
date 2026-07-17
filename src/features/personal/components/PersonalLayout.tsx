import { NavLink, Outlet, useLocation } from 'react-router-dom'

// Shared shell for the Personal nav group (Daily/Shop/Recipes). Routes are
// unchanged (/daily, /shop, /recipes) so every existing deep link keeps
// working; only what renders above the page content changed.
const TABS = [
  { to: '/daily',   label: 'Daily'   },
  { to: '/shop',    label: 'Shop'    },
  { to: '/recipes', label: 'Recipes' },
]

// Exported so DailyPage can embed the group tabs INSIDE its own single
// header row (far right) instead of stacking a separate bar above the page —
// part of collapsing Daily's old three-row header into one.
export function PersonalTabs() {
  return (
    <div className="inline-flex items-center gap-0.5 bg-cream-100 rounded-xl p-1">
      {TABS.map(tab => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => [
            'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[36px] flex items-center whitespace-nowrap',
            isActive ? 'bg-cream-50 text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-700',
          ].join(' ')}
        >
          {tab.label}
        </NavLink>
      ))}
    </div>
  )
}

export function PersonalLayout() {
  const { pathname } = useLocation()
  // Daily renders PersonalTabs inside its own compact header row — showing
  // the standalone bar too would duplicate it and waste a whole row.
  const showBar = !pathname.startsWith('/daily')

  // h-full (not a vh/dvh calc) so this resolves against <main>'s own
  // computed flex height, which already accounts for the mobile bottom tab
  // bar's reserved padding — a hardcoded vh subtraction here would ignore
  // that reservation and run this content's tail under the fixed tab bar.
  return (
    <div className="h-full flex flex-col">
      {showBar && (
        <div className="flex-shrink-0 px-4 sm:px-6 lg:px-8 pt-4">
          <PersonalTabs />
        </div>
      )}
      {/* overflow-y-auto (not hidden): Daily/Recipes are plain page-flow content
          that need the wrapper to scroll; Shop manages its own fixed h-full
          two-pane layout internally and fits exactly, so this never double-scrolls. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  )
}
