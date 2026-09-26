import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { Search, Sparkles, ClipboardList } from 'lucide-react'
import { useUIStore } from '../store'
import { routeTitle } from '../navigation'
import { SettingsMenu } from '../../shared/components/SettingsMenu'
import { cx } from '../../shared/ui'

/**
 * Tablet/desktop top bar (≥768px). No background of its own — it sits on the
 * canvas. Page title · search trigger (opens ⌘K) · Ask AI · Requests · avatar.
 */
export function AppTopBar() {
  const { pathname } = useLocation()
  const openCommandBar = useUIStore(s => s.openCommandBar)
  const isAIOpen = useUIStore(s => s.isAIOpen)
  const toggleAI = useUIStore(s => s.toggleAI)
  const isDevRequestsOpen = useUIStore(s => s.isDevRequestsOpen)
  const toggleDevRequests = useUIStore(s => s.toggleDevRequests)

  return (
    <header className="vt-pin-topbar flex h-[calc(4rem+env(safe-area-inset-top))] shrink-0 items-center gap-2 pl-5 pr-3 pt-[env(safe-area-inset-top)] lg:gap-3 lg:pl-8 lg:pr-5">
      <p className="min-w-0 max-w-[14rem] shrink truncate text-title font-semibold tracking-tight text-fg">{routeTitle(pathname)}</p>

      <button
        type="button"
        onClick={openCommandBar}
        aria-label="Search or jump to"
        aria-keyshortcuts="Meta+K Control+K"
        className="flex h-10 min-w-[96px] max-w-[460px] flex-1 items-center gap-2.5 rounded-input border border-line bg-surface px-3.5 text-left text-body text-fg-faint transition-colors duration-100 [@media(hover:hover)]:hover:border-line-strong [@media(pointer:coarse)]:h-11"
      >
        <Search className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={2} aria-hidden />
        <span className="min-w-0 flex-1 truncate">Search or jump to…</span>
        <kbd className="kbd hidden xl:inline-flex">⌘K</kbd>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <ShellToggle label="Ask AI" icon={<Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />} on={isAIOpen} onClick={toggleAI} />
        <ShellToggle label="Requests" icon={<ClipboardList className="h-4 w-4" strokeWidth={2} aria-hidden />} on={isDevRequestsOpen} onClick={toggleDevRequests} />
        <SettingsMenu />
      </div>
    </header>
  )
}

/** Icon + label button that toggles a side drawer; label hides below lg. */
function ShellToggle({ label, icon, on, onClick }: { label: string; icon: ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-control border px-2.5 text-body font-semibold transition-colors duration-100 lg:px-3.5 [@media(pointer:coarse)]:h-11',
        on
          ? 'border-accent-500/30 bg-accent-50 text-accent-700'
          : 'border-line bg-surface text-fg-2 [@media(hover:hover)]:hover:border-line-strong [@media(hover:hover)]:hover:text-fg',
      )}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  )
}
