import { NavLink, Outlet } from 'react-router-dom'
import { useUIStore } from '../../../app/store'

// Shared shell for the Personal nav group (Daily/Shop/Recipes). Routes are
// unchanged (/daily, /shop, /recipes) so every existing deep link keeps
// working; only what renders above the page content changed.
const TABS = [
  { to: '/daily',   label: 'Daily'   },
  { to: '/shop',    label: 'Shop'    },
  { to: '/recipes', label: 'Food' },
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
            'px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors min-h-[44px] flex items-center whitespace-nowrap',
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
  // The STANDARD for the Personal tabs: they render INSIDE each page's own
  // first header row, far right (Daily, Shop and Recipes all do this) — the
  // old standalone bar here cost a whole row and pushed page headings down
  // one line ("Recipes başlığı neden bir satır aşağıda"). Same spot on every
  // page, no layout jump between them.
  //
  // h-full (not a vh/dvh calc) so this resolves against <main>'s own
  // computed flex height, which already accounts for the mobile bottom tab
  // bar's reserved padding — a hardcoded vh subtraction here would ignore
  // that reservation and run this content's tail under the fixed tab bar.
  // This inner div is the ACTUAL scroll container for /daily,/shop,/recipes
  // (the app's <main> never scrolls on these routes), so it must feed the same
  // hide-on-scroll header the rest of the app drives from <main>. Without this
  // the top header stayed permanently pinned on the whole Personal group.
  const reportScroll = useUIStore(s => s.reportScroll)
  return (
    <div className="h-full flex flex-col">
      {/* overflow-y-auto (not hidden): Daily/Recipes are plain page-flow content
          that need the wrapper to scroll; Shop manages its own fixed h-full
          two-pane layout internally and fits exactly, so this never double-scrolls. */}
      <div className="flex-1 min-h-0 overflow-y-auto" onScroll={e => reportScroll((e.target as HTMLElement).scrollTop)}>
        <Outlet />
      </div>
    </div>
  )
}
