import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { MoreHorizontal } from 'lucide-react'
import { TAB_ENTRIES, MORE_ENTRIES, isActive } from '../navigation'
import { useNavClick } from './useNavClick'
import { MoreSheet } from './MoreSheet'
import { cx } from '../../shared/ui'

/**
 * Phone tab bar: a flat, full-width glass bar (content scrolls behind it),
 * the primary tabs from the registry + More. Tapping a tab slides the page
 * in from the side of the tapped tab; re-tapping the active tab scrolls it
 * back to the top.
 */
export function BottomTabBar() {
  const { pathname } = useLocation()
  const onNav = useNavClick()
  // Open state remembers the page it was opened on, so any navigation closes
  // the sheet without an effect (and without a Back of its own).
  const [openOn, setOpenOn] = useState<string | null>(null)
  const moreOpen = openOn === pathname
  const activeIndex = TAB_ENTRIES.findIndex(e => isActive(e, pathname))
  const moreActive = MORE_ENTRIES.some(e => isActive(e, pathname))

  return (
    <>
      <nav
        aria-label="Main"
        className="vt-pin-tabbar glass-chrome fixed inset-x-0 bottom-0 z-chrome select-none border-t border-line pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      >
        <div className="flex h-tabbar items-stretch">
          {TAB_ENTRIES.map((entry, index) => {
            const active = index === activeIndex
            const Icon = entry.icon
            return (
              <Link
                key={entry.id}
                to={entry.path}
                aria-current={active ? 'page' : undefined}
                onClick={onNav(entry.path, { active, direction: activeIndex >= 0 && index < activeIndex ? 'back' : 'forward' })}
                className={cx(
                  'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px] leading-none transition-colors duration-150',
                  active ? 'font-semibold text-accent-600' : 'font-medium text-fg-muted',
                )}
              >
                <span className={cx('grid h-6 place-items-center', active && 'animate-tabPop')}>
                  <Icon className="h-[22px] w-[22px]" strokeWidth={1.8} aria-hidden />
                </span>
                {entry.label}
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => setOpenOn(pathname)}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cx(
              'flex min-h-[56px] flex-1 flex-col items-center justify-center gap-[3px] text-[11px] leading-none transition-colors duration-150',
              moreActive ? 'font-semibold text-accent-600' : 'font-medium text-fg-muted',
            )}
          >
            <span className="grid h-6 place-items-center">
              <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={1.8} aria-hidden />
            </span>
            More
          </button>
        </div>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setOpenOn(null)} />
    </>
  )
}
