import { useEffect, useRef, useState, type RefObject } from 'react'
import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { PlatformGroup } from '../testGameModel'
import { GameLibraryMark } from './platformArt'
import { TgSidebarItem } from './TgSidebarItem'
import { TgNavPlatforms } from './TgNavPlatforms'
import { TG_SECTION_ENTRIES, sectionCount, type TgNavCounts } from './tgSections'
import { useTgAddGame } from './tgAddGame'

// The design's bold near-white (near-black in light) glyphs; the active row
// keeps the nav's own active colour.
const navIcon = (active: boolean) => `tg-nav-icon ${active ? '' : 'text-[var(--tg-text)]'}`

// Fades the list's bottom edge while more rows sit below it: on a touch
// tablet the rows grow to 44px and the last platforms slip out of view, and
// iOS shows no scrollbar until you scroll, so the list would read as complete.
const FADE = '[mask-image:linear-gradient(#000_calc(100%-28px),transparent)] [-webkit-mask-image:linear-gradient(#000_calc(100%-28px),transparent)]'

function useMoreBelow(ref: RefObject<HTMLElement | null>, active: boolean): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 2)
    // Observing reports once straight away, so this also sets the first value.
    const ro = new ResizeObserver(check)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild) // the content, as rows load
    el.addEventListener('scroll', check, { passive: true })
    return () => { ro.disconnect(); el.removeEventListener('scroll', check) }
  }, [ref, active])
  return more
}

/**
 * Tablet + desktop: the page's own navigation — sections, every platform
 * grouped by maker, and the tools (Add game, Scrape, Advanced) — as a panel
 * on the left of the games. It folds to an icon rail (saved), and the app's
 * own sidebar starts folded on this page, so the games keep the width.
 */
export function TgNavPanel({ counts, groups }: { counts: TgNavCounts; groups: PlatformGroup[] }) {
  const section = useTestGameStore(s => s.section)
  const setSection = useTestGameStore(s => s.setSection)
  const collapsed = useTestGameStore(s => s.navCollapsed)
  const setCollapsed = useTestGameStore(s => s.setNavCollapsed)
  const navRef = useRef<HTMLDivElement>(null)
  const moreBelow = useMoreBelow(navRef, !collapsed)
  const openAddGame = useTgAddGame(s => s.setOpen)
  const sections = TG_SECTION_ENTRIES.filter(e => !e.tool)
  const tools = TG_SECTION_ENTRIES.filter(e => e.tool)

  const item = (e: (typeof TG_SECTION_ENTRIES)[number]) => {
    const active = section === e.key
    return (
      <TgSidebarItem
        key={e.key}
        iconOnly={collapsed}
        icon={<e.icon className={navIcon(active)} strokeWidth={2.2} />}
        label={e.label}
        count={sectionCount(e, counts)}
        accentCount={e.count === 'queue'}
        active={active}
        // "Library" re-picked drops a platform or genre picked elsewhere (the
        // store's rule); re-picking Scrape keeps an open review.
        onClick={() => setSection(e.key)}
      />
    )
  }

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <nav
      id="tg-nav"
      aria-label="Game Library"
      className={`tg-sidebar mb-4 mt-1 ml-3 flex shrink-0 flex-col overflow-hidden rounded-[18px] border border-[var(--tg-border)] transition-[width] duration-200 ease-out lg:ml-4 ${
        collapsed ? 'w-[60px]' : 'w-[220px]'
      }`}
    >
      <div className={`flex h-14 shrink-0 items-center ${collapsed ? 'justify-center' : 'gap-2.5 pl-4 pr-1.5'}`}>
        {!collapsed && (
          <>
            <GameLibraryMark className="shrink-0 text-[var(--tg-text)]" />
            <span className="min-w-0 flex-1 truncate text-[16px] font-bold tracking-[-0.01em] text-[var(--tg-text)]">Game Library</span>
          </>
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-controls="tg-nav"
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand Game Library navigation' : 'Collapse Game Library navigation'}
          title={collapsed ? 'Expand' : 'Collapse'}
          className="tg-icon-btn shrink-0 text-[var(--tg-muted)]"
        >
          <ToggleIcon aria-hidden size={18} strokeWidth={2} />
        </button>
      </div>

      <div ref={navRef} className={`tg-scroll-y min-h-0 flex-1 pb-2 ${collapsed ? 'px-2' : 'px-2.5'} ${!collapsed && moreBelow ? FADE : ''}`}>
        <div>
          <div className="flex flex-col gap-px">{sections.map(item)}</div>
          {!collapsed && <TgNavPlatforms groups={groups} />}
        </div>
      </div>

      <div className={`flex shrink-0 flex-col gap-px border-t border-[var(--tg-border)] pb-2.5 pt-1.5 ${collapsed ? 'px-2' : 'px-2.5'}`}>
        <TgSidebarItem
          iconOnly={collapsed}
          icon={<Plus aria-hidden className={navIcon(false)} strokeWidth={2.2} />}
          label="Add game"
          active={false}
          onClick={() => openAddGame(true)}
        />
        {tools.map(item)}
      </div>
    </nav>
  )
}
