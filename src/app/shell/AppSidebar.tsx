import { Link, useLocation } from 'react-router-dom'
import { NAV_GROUPS, SIDEBAR_ENTRIES, isActive, type NavEntry } from '../navigation'
import { useNavClick } from './useNavClick'
import { cx } from '../../shared/ui'

/**
 * Tablet/desktop navigation (THEME.md §6.1): a 232px sidebar with group labels
 * from 1280px, a 68px icon rail from 768px. Opaque surface — nothing scrolls
 * behind it, so glass would only look muddy.
 */
export function AppSidebar({ rail }: { rail: boolean }) {
  const { pathname } = useLocation()
  const system = SIDEBAR_ENTRIES.filter(e => e.group === 'system')

  return (
    <aside
      className={cx(
        'vt-pin-sidebar flex h-full shrink-0 flex-col border-r border-line bg-surface',
        'pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]',
        rail ? 'w-[calc(68px+env(safe-area-inset-left))]' : 'w-[calc(var(--app-sidebar-w)+env(safe-area-inset-left))]',
      )}
    >
      <Link
        to="/home"
        aria-label="Lasci's Board — Home"
        className={cx('flex h-16 shrink-0 items-center gap-3', rail ? 'justify-center' : 'px-[18px]')}
      >
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-7 w-7" />
        {!rail && <span className="truncate text-ui font-bold tracking-tight text-fg">Lasci's Board</span>}
      </Link>

      <nav aria-label="Main" className="scroll-y flex min-h-0 flex-1 flex-col overflow-y-auto px-2.5 pb-3">
        {NAV_GROUPS.map((group, i) => {
          const entries = SIDEBAR_ENTRIES.filter(e => e.group === group.id)
          if (!entries.length) return null
          return (
            <div key={group.id} className="flex flex-col gap-px">
              {rail
                ? i > 0 && <div aria-hidden className="mx-3 my-2 h-px bg-line" />
                : <p className={cx('section-label mb-1.5 pl-3', i === 0 ? 'mt-2' : 'mt-5')}>{group.label}</p>}
              {entries.map(e => <SidebarItem key={e.id} entry={e} rail={rail} active={isActive(e, pathname)} />)}
            </div>
          )
        })}
      </nav>

      {system.length > 0 && (
        <div className="flex shrink-0 flex-col gap-px border-t border-line px-2.5 pb-2.5 pt-1.5">
          {system.map(e => <SidebarItem key={e.id} entry={e} rail={rail} active={isActive(e, pathname)} />)}
        </div>
      )}
    </aside>
  )
}

function SidebarItem({ entry, rail, active }: { entry: NavEntry; rail: boolean; active: boolean }) {
  const onNav = useNavClick()
  const Icon = entry.icon
  return (
    <Link
      to={entry.path}
      onClick={onNav(entry.path, { active })}
      aria-current={active ? 'page' : undefined}
      aria-label={rail ? entry.label : undefined}
      title={rail ? entry.label : undefined}
      className={cx(
        'flex items-center rounded-control text-body transition-colors duration-100',
        rail
          ? 'mx-auto h-11 w-11 justify-center'
          : 'min-h-[38px] gap-3 pl-3 pr-2 [@media(pointer:coarse)]:min-h-[44px]',
        active
          ? 'bg-accent-50 font-semibold text-accent-700'
          : 'font-medium text-fg-2 [@media(hover:hover)]:hover:bg-surface-hover [@media(hover:hover)]:hover:text-fg active:bg-surface-hover',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={2} aria-hidden />
      {!rail && <span className="truncate">{entry.label}</span>}
    </Link>
  )
}
