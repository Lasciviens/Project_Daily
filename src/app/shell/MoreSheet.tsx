import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronRight, Plug, LogOut } from 'lucide-react'
import { MORE_ENTRIES, isActive } from '../navigation'
import { useNavClick } from './useNavClick'
import { ModalShell } from '../../shared/modals'
import { ThemeSwitch, AccentSwatches, NotificationsControl } from '../../shared/components/SettingsMenu'
import { signOut } from '../../security/supabaseClient'
import { cx } from '../../shared/ui'

const ROW = 'flex min-h-[48px] w-full items-center gap-3 rounded-row px-3 text-lead font-medium transition-colors duration-100'
const ROW_IDLE = 'text-fg-2 active:bg-surface-hover [@media(hover:hover)]:hover:bg-surface-hover'

/**
 * Phone "More": the destinations without a tab slot (Wishes first), then the
 * settings a phone otherwise can't reach comfortably. Links REPLACE the
 * sheet's own history entry, so one Back from the new page returns to where
 * the sheet was opened.
 */
export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation()
  const onNav = useNavClick()
  const navigate = useNavigate()

  return (
    <ModalShell open={open} onClose={onClose} title="More" size="sm" bodyClassName="px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
      <nav aria-label="More pages" className="flex flex-col gap-0.5">
        {MORE_ENTRIES.map(entry => {
          const active = isActive(entry, pathname)
          const Icon = entry.icon
          return (
            <Link
              key={entry.id}
              to={entry.path}
              aria-current={active ? 'page' : undefined}
              onClick={e => { if (active) onClose(); onNav(entry.path, { active, replace: true })(e) }}
              className={cx(ROW, active ? 'bg-accent-50 font-semibold text-accent-700' : ROW_IDLE)}
            >
              <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={1.8} aria-hidden />
              <span className="flex-1">{entry.label}</span>
            </Link>
          )
        })}
      </nav>

      <div aria-hidden className="my-3 h-px bg-line" />
      <p className="section-label mb-2 px-3">Settings</p>

      <Setting label="Appearance"><ThemeSwitch /></Setting>
      <Setting label="Accent"><AccentSwatches /></Setting>
      <div className="flex flex-col">
        <NotificationsControl className={cx(ROW, ROW_IDLE)} />
      </div>
      <Link
        to="/developer?tab=connections"
        // Plain replace-then-close: on /developer itself only the query
        // changes, which would leave the sheet open.
        onClick={e => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
          e.preventDefault()
          navigate('/developer?tab=connections', { replace: true })
          onClose()
        }}
        className={cx(ROW, ROW_IDLE)}
      >
        <Plug className="h-[19px] w-[19px] shrink-0" strokeWidth={1.8} aria-hidden />
        <span className="flex-1">Connections</span>
        <ChevronRight className="h-4 w-4 text-fg-faint" aria-hidden />
      </Link>
      <button type="button" onClick={() => signOut()} className={cx(ROW, ROW_IDLE)}>
        <LogOut className="h-[19px] w-[19px] shrink-0" strokeWidth={1.8} aria-hidden />
        <span className="flex-1 text-left">Sign out</span>
      </button>
    </ModalShell>
  )
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-1">
      <span className="text-lead font-medium text-fg-2">{label}</span>
      {children}
    </div>
  )
}
