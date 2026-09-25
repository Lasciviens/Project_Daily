import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'
import {
  Archive, ArrowLeft, ChartColumn, CircleCheck, Heart, ListVideo, SlidersHorizontal,
} from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { PlatformCount, TgSection } from '../testGameModel'
import { GameLibraryMark } from './platformArt'
import { TgSidebarItem } from './TgSidebarItem'
import { TgSidebarPlatforms } from './TgSidebarPlatforms'

interface NavCounts { queue: number; wishlist: number; completed: number; backlog: number }

// Library uses the logo's solid pad, as the design draws it; the rest are lucide.
const NAV: { key: TgSection; label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }>; count?: keyof NavCounts }[] = [
  { key: 'library', label: 'Library', icon: GameLibraryMark },
  { key: 'queue', label: 'Play Queue', icon: ListVideo, count: 'queue' },
  { key: 'wishlist', label: 'Wishlist', icon: Heart, count: 'wishlist' },
  { key: 'completed', label: 'Completed', icon: CircleCheck, count: 'completed' },
  { key: 'backlog', label: 'Backlog', icon: Archive, count: 'backlog' },
  { key: 'analytics', label: 'Analytics', icon: ChartColumn },
]

/** Tablet + desktop navigation: sections, platforms, and the way out. */
export function TgSidebar({ counts, platforms, others }: {
  counts: NavCounts
  platforms: PlatformCount[]
  others: PlatformCount[]
}) {
  const section = useTestGameStore(s => s.section)
  const setSection = useTestGameStore(s => s.setSection)

  return (
    <aside aria-label="Game Library" className="tg-sidebar flex h-full w-[224px] shrink-0 flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 px-[18px]">
        <GameLibraryMark className="shrink-0 text-[var(--tg-text)]" />
        <span className="truncate text-[18px] font-bold tracking-[-0.01em] text-[var(--tg-text)]">Game Library</span>
      </div>

      <nav aria-label="Sections" className="tg-scroll-y min-h-0 flex-1 px-2.5 pb-2">
        <div className="flex flex-col gap-px">
          {NAV.map(n => {
            const count = n.count ? counts[n.count] : undefined
            // Wishlist carries no badge while empty, as the design draws it.
            const shown = n.count === 'wishlist' && !count ? undefined : count
            return (
              <TgSidebarItem
                key={n.key}
                icon={<n.icon className="tg-nav-icon" strokeWidth={1.8} />}
                label={n.label}
                count={shown}
                accentCount={n.count === 'queue' && !!count}
                active={section === n.key}
                onClick={() => setSection(n.key)}
              />
            )
          })}
        </div>
        <TgSidebarPlatforms platforms={platforms} others={others} />
      </nav>

      <div className="shrink-0 border-t border-[var(--tg-border)] px-2.5 pb-2.5 pt-1.5">
        <TgSidebarItem
          icon={<SlidersHorizontal aria-hidden className="tg-nav-icon" strokeWidth={1.8} />}
          label="Advanced"
          active={section === 'advanced'}
          onClick={() => setSection('advanced')}
        />
        <Link
          to="/games"
          className="mt-0.5 flex min-h-[30px] items-center gap-2 rounded-[10px] px-3 text-[12px] font-medium text-[var(--tg-muted)] transition-colors hover:bg-[var(--tg-hover)] hover:text-[var(--tg-text)] [@media(pointer:coarse)]:min-h-[44px]"
        >
          <ArrowLeft aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Back to Lasci&apos;s Board
        </Link>
      </div>
    </aside>
  )
}
