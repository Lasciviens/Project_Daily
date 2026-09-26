import { Link, useLocation } from 'react-router-dom'
import { cx } from '../../../shared/ui'

// Food ↔ Shop switch, embedded in the first header row of RecipesPage and
// ShopPage (same spot on both, no extra row). Both routes light the one
// "Food" nav entry (src/app/navigation.ts).
//
// There used to be a PersonalLayout route wrapper here with its own
// full-height scroller; it broke re-tap-to-top and Back scroll restore (both
// target <main>). The pages now scroll in <main> like every other route, and
// Shop sizes itself via the registry's `fullHeight` flag.
const TABS = [
  { to: '/recipes', label: 'Food' },
  { to: '/shop', label: 'Shop' },
]

export function FoodTabs() {
  const { pathname } = useLocation()
  return (
    <nav aria-label="Food sections" className="seg shrink-0">
      {TABS.map(tab => {
        const active = pathname === tab.to
        return (
          <Link
            key={tab.to}
            to={tab.to}
            aria-current={active ? 'page' : undefined}
            className={cx('seg-btn inline-flex items-center justify-center [@media(pointer:coarse)]:min-h-[44px]', active ? 'is-active' : '[@media(hover:hover)]:hover:text-fg')}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
