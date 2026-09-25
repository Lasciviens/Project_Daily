import { useState, type ReactNode } from 'react'
import { Ellipsis, Gamepad2, Heart, SquarePlus } from 'lucide-react'
import { useTestGameStore } from '../testGameStore'
import type { TgSection } from '../testGameModel'
import { TgMobileGamepad } from './TgMobileGlyph'
import { TgMobileMoreSheet } from './TgMobileMoreSheet'

const MORE_SECTIONS: TgSection[] = ['completed', 'backlog', 'analytics', 'advanced']

function TabButton({ label, active, onClick, children, opensSheet = false }: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
  /** "More" opens a sheet rather than being a page itself. */
  opensSheet?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active && !opensSheet ? 'page' : undefined}
      aria-haspopup={opensSheet ? 'dialog' : undefined}
      className={`tg-tab-item ${active ? 'is-active' : ''}`}
    >
      <span className="relative flex h-6 items-center justify-center">{children}</span>
      <span className={active ? 'font-semibold' : undefined}>{label}</span>
    </button>
  )
}

/** The phone's bottom tab bar: Library · Queue · Wishlist · More, as the design draws it. */
export function TgBottomTabs({ counts }: {
  counts: { queue: number; wishlist: number; completed: number; backlog: number }
}) {
  const section = useTestGameStore(s => s.section)
  const setSection = useTestGameStore(s => s.setSection)
  const [moreOpen, setMoreOpen] = useState(false)
  // setSection resets the status filter and platform scope, so re-tapping the
  // current tab must not quietly clear what the filter sheet just set.
  const go = (s: TgSection) => { if (s !== section) setSection(s) }
  const icon = { size: 22, strokeWidth: 1.8, 'aria-hidden': true } as const

  return (
    <>
      <nav
        aria-label="Game Library sections"
        className="tg-bottom-bar fixed inset-x-0 bottom-0 z-40 flex pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]"
      >
        <TabButton label="Library" active={section === 'library'} onClick={() => go('library')}>
          {section === 'library' ? <TgMobileGamepad size={24} /> : <Gamepad2 {...icon} />}
        </TabButton>
        <TabButton label="Queue" active={section === 'queue'} onClick={() => go('queue')}>
          <SquarePlus {...icon} />
          {counts.queue > 0 && (
            <span className="absolute -right-2.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--tg-accent)] px-1 text-[10px] font-semibold leading-none tabular-nums text-[var(--tg-on-accent)] ring-2 ring-[var(--tg-sidebar)]">
              {counts.queue > 99 ? '99+' : counts.queue}
              <span className="sr-only"> in queue</span>
            </span>
          )}
        </TabButton>
        <TabButton label="Wishlist" active={section === 'wishlist'} onClick={() => go('wishlist')}>
          <Heart {...icon} className={section === 'wishlist' ? 'fill-[var(--tg-accent-soft)]' : undefined} />
        </TabButton>
        <TabButton label="More" active={MORE_SECTIONS.includes(section)} onClick={() => setMoreOpen(true)} opensSheet>
          <Ellipsis {...icon} />
        </TabButton>
      </nav>
      <TgMobileMoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} counts={counts} />
    </>
  )
}
