import { useEffect, useRef, useState, type ComponentType, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  Archive, ArrowLeft, ChartColumn, CircleCheckBig, Heart, Plus, SlidersHorizontal, SquarePlay, Wand2,
} from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { PlatformCount, TgSection } from '../testGameModel'
import { GameLibraryMark } from './platformArt'
import { TgSidebarItem } from './TgSidebarItem'
import { TgSidebarPlatforms } from './TgSidebarPlatforms'
import { useTgAddGame } from './tgAddGame'

interface NavCounts { queue: number; wishlist: number; completed: number; backlog: number; review?: number }

// Library uses the logo's solid pad, as the design draws it; the rest are lucide.
const NAV: { key: TgSection; label: string; icon: ComponentType<{ className?: string; strokeWidth?: number }>; count?: keyof NavCounts }[] = [
  { key: 'library', label: 'Library', icon: GameLibraryMark },
  { key: 'queue', label: 'Play Queue', icon: SquarePlay, count: 'queue' },
  { key: 'wishlist', label: 'Wishlist', icon: Heart, count: 'wishlist' },
  { key: 'completed', label: 'Completed', icon: CircleCheckBig, count: 'completed' },
  { key: 'backlog', label: 'Backlog', icon: Archive, count: 'backlog' },
  { key: 'analytics', label: 'Analytics', icon: ChartColumn },
]

// The design's bold near-white (near-black in light) glyphs; the active row
// keeps the nav's own active colour.
const navIcon = (active: boolean) => `tg-nav-icon ${active ? '' : 'text-[var(--tg-text)]'}`

// Fades the list's bottom edge while more rows sit below it: on a touch
// tablet the rows grow to 44px and the last platforms slip out of view, and
// iOS shows no scrollbar until you scroll, so the list would read as complete.
const FADE = '[mask-image:linear-gradient(#000_calc(100%-28px),transparent)] [-webkit-mask-image:linear-gradient(#000_calc(100%-28px),transparent)]'

function useMoreBelow(ref: RefObject<HTMLElement | null>): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2)
    // Observing reports once straight away, so this also sets the first value.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild) // the content, as rows load
    el.addEventListener('scroll', check, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', check) }
  }, [ref])
  return more
}

/** Tablet + desktop navigation: sections, platforms, and the way out. */
export function TgSidebar({ counts, platforms, others }: {
  counts: NavCounts
  platforms: PlatformCount[]
  others: PlatformCount[]
}) {
  const section = useTestGameStore(s => s.section)
  const setSection = useTestGameStore(s => s.setSection)
  const navRef = useRef<HTMLElement>(null)
  const moreBelow = useMoreBelow(navRef)
  const openAddGame = useTgAddGame(s => s.setOpen)

  return (
    <aside
      aria-label="Game Library"
      // Insets: an installed iPad PWA's status bar and home indicator, a landscape phone's notch.
      className="tg-sidebar flex h-full w-[calc(224px+env(safe-area-inset-left))] shrink-0 flex-col pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pt-[env(safe-area-inset-top)]"
    >
      <div className="flex h-16 shrink-0 items-center gap-3 px-[18px]">
        <GameLibraryMark className="shrink-0 text-[var(--tg-text)]" />
        <span className="truncate text-[18px] font-bold tracking-[-0.01em] text-[var(--tg-text)]">Game Library</span>
      </div>

      <nav ref={navRef} aria-label="Sections" className={`tg-scroll-y min-h-0 flex-1 px-2.5 pb-2 ${moreBelow ? FADE : ''}`}>
        <div>
          <div className="flex flex-col gap-px">
            {NAV.map(n => {
              const count = n.count ? counts[n.count] : undefined
              // Wishlist carries no badge while empty, as the design draws it.
              const shown = n.count === 'wishlist' && !count ? undefined : count
              const active = section === n.key
              return (
                <TgSidebarItem
                  key={n.key}
                  icon={<n.icon className={navIcon(active)} strokeWidth={2.2} />}
                  label={n.label}
                  count={shown}
                  accentCount={n.count === 'queue' && !!count}
                  active={active}
                  onClick={() => setSection(n.key)}
                />
              )
            })}
          </div>
          <TgSidebarPlatforms platforms={platforms} others={others} />
        </div>
      </nav>

      <div className="shrink-0 border-t border-[var(--tg-border)] px-2.5 pb-2.5 pt-1.5">
        <TgSidebarItem
          icon={<Plus aria-hidden className={navIcon(false)} strokeWidth={2.2} />}
          label="Add game"
          active={false}
          onClick={() => openAddGame(true)}
        />
        <TgSidebarItem
          icon={<Wand2 aria-hidden className={navIcon(section === 'scrape')} strokeWidth={2.2} />}
          label="Scrape"
          active={section === 'scrape'}
          onClick={() => setSection('scrape')}
        />
        <TgSidebarItem
          icon={<SlidersHorizontal aria-hidden className={navIcon(section === 'advanced')} strokeWidth={2.2} />}
          label="Advanced"
          active={section === 'advanced'}
          onClick={() => setSection('advanced')}
          count={counts.review || undefined}
        />
        <Link to="/home" className="mt-0.5 flex min-h-[30px] items-center gap-2 rounded-[10px] px-3 text-[12px] font-medium text-[var(--tg-muted)] transition-colors [@media(hover:hover)]:hover:bg-[var(--tg-hover)] [@media(hover:hover)]:hover:text-[var(--tg-text)] [@media(pointer:coarse)]:min-h-[44px]">
          <ArrowLeft aria-hidden className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Back to Lasci&apos;s Board
        </Link>
      </div>
    </aside>
  )
}
