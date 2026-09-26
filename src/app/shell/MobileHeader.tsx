import { useLocation } from 'react-router-dom'
import { Search, Sparkles, ClipboardList } from 'lucide-react'
import { useUIStore } from '../store'
import { routeTitle } from '../navigation'
import { SettingsMenu } from '../../shared/components/SettingsMenu'
import { IconButton, cx } from '../../shared/ui'

/**
 * Phone header (< 768px, or a landscape phone). Glass over the status bar
 * (black-translucent PWA), so its content starts below the safe-area inset.
 * Slides away while scrolling down and returns on any upward scroll; a
 * matching negative margin lets <main> fill the gap.
 */
export function MobileHeader() {
  const { pathname } = useLocation()
  const hidden = useUIStore(s => s.chromeHidden)
  const scrolled = useUIStore(s => s.chromeScrolled)
  const openCommandBar = useUIStore(s => s.openCommandBar)
  const isAIOpen = useUIStore(s => s.isAIOpen)
  const toggleAI = useUIStore(s => s.toggleAI)
  const isDevRequestsOpen = useUIStore(s => s.isDevRequestsOpen)
  const toggleDevRequests = useUIStore(s => s.toggleDevRequests)

  return (
    <header
      className={cx(
        'vt-pin-header glass-chrome relative z-chrome shrink-0 border-b pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]',
        'transition-[box-shadow,border-color,transform,margin] duration-300 will-change-transform',
        scrolled ? 'border-line shadow-float' : 'border-line/60',
        hidden && '-translate-y-full -mb-[calc(var(--app-header-h)+env(safe-area-inset-top))]',
      )}
    >
      <div className="flex h-header items-center gap-1 pl-4 pr-1.5">
        <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="h-7 w-7 shrink-0" />
        <p className="ml-1.5 min-w-0 flex-1 truncate text-head font-bold tracking-tight text-fg">{routeTitle(pathname)}</p>
        <IconButton label="Search" onClick={openCommandBar}><Search strokeWidth={1.9} aria-hidden /></IconButton>
        <IconButton label="Ask AI" aria-pressed={isAIOpen} onClick={toggleAI} className={isAIOpen ? 'bg-accent-50 !text-accent-700' : undefined}>
          <Sparkles strokeWidth={1.9} aria-hidden />
        </IconButton>
        <IconButton label="Requests" aria-pressed={isDevRequestsOpen} onClick={toggleDevRequests} className={isDevRequestsOpen ? 'bg-accent-50 !text-accent-700' : undefined}>
          <ClipboardList strokeWidth={1.9} aria-hidden />
        </IconButton>
        <SettingsMenu />
      </div>
    </header>
  )
}
