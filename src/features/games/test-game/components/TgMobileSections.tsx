import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useTestGameStore } from '../testGameStore'
import { TG_SECTION_ENTRIES, sectionCount, type TgNavCounts } from './tgSections'

/**
 * The phone's section row under the app header: every section as a pill
 * (scrolling sideways), with page-wide actions pinned at its end — search and
 * the library's ⋯ menu. It replaces the page's old bottom tab bar and More
 * sheet: the app's own tab bar is the phone's chrome now.
 */
export function TgMobileSections({ counts, actions }: { counts: TgNavCounts; actions?: ReactNode }) {
  const section = useTestGameStore(s => s.section)
  const setSection = useTestGameStore(s => s.setSection)
  // Keeps the active pill on screen when it sits past the row's edge — again
  // once the counts arrive, since they widen the pills before it.
  const activeRef = useRef<HTMLButtonElement>(null)
  const countsKey = `${counts.queue}|${counts.wishlist}|${counts.completed}|${counts.backlog}|${counts.review}`
  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [section, countsKey])

  return (
    <div className="flex items-center gap-1 pr-[max(0.5rem,env(safe-area-inset-right))] pt-1.5">
      <nav
        aria-label="Game Library sections"
        className="tg-scroll-x flex min-w-0 flex-1 gap-1.5 py-1 pl-[max(1rem,env(safe-area-inset-left))] pr-2 scroll-pl-[max(1rem,env(safe-area-inset-left))]"
      >
        {TG_SECTION_ENTRIES.map(e => {
          const active = section === e.key
          const count = sectionCount(e, counts)
          return (
            <button
              key={e.key}
              ref={active ? activeRef : undefined}
              type="button"
              aria-current={active ? 'page' : undefined}
              // setSection resets the status filter and platform scope, so
              // re-tapping the current pill must not clear what a sheet just set.
              onClick={() => { if (!active) setSection(e.key) }}
              className={`tg-tab shrink-0 !gap-1.5 !px-3.5 ${active ? 'is-active' : 'bg-[var(--tg-panel)] ring-1 ring-inset ring-[var(--tg-border)]'}`}
            >
              {e.short}
              {count != null && (
                <span className="tg-tab-count inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-1.5">
                  {count > 999 ? '999+' : count}
                </span>
              )}
            </button>
          )
        })}
      </nav>
      {actions}
    </div>
  )
}
